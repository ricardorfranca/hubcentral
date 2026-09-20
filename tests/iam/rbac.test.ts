import { describe, it, expect, afterAll } from "vitest";
import fc from "fast-check";
import type { PoolClient } from "pg";
import { withRollback, closeTestPool } from "../helpers/db.js";
import {
  grantNamespace,
  revokeNamespace,
  setUserPermissions,
  listUserPermissions,
  hasNamespace,
  authorize,
  isSuperadmin,
} from "../../src/core/iam/rbac.js";
import { ALL_NAMESPACES } from "../../src/core/iam/namespaces.js";
import { DomainError, ErrorCode } from "../../src/core/errors.js";

/**
 * @file rbac.test.ts
 *
 * Testes de autorização RBAC (Tarefa 12). Cobre P25 (autorização por posse de
 * namespace, incluindo negação sem autenticação).
 */

const RUNS = { numRuns: 100 } as const;

afterAll(async () => {
  await closeTestPool();
});

/** Cria um usuário (dentro da transação) e retorna seu id. */
async function newUser(client: PoolClient): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO core.users (email, full_name)
     VALUES ($1, 'RBAC User') RETURNING id`,
    [`rbac-${Math.random().toString(36).slice(2)}@example.com`],
  );
  return rows[0]!.id;
}

/**
 * Cria um usuário e o promove a `role = 'superadmin'` (dentro da transação),
 * retornando seu id. `newUser` cria usuário com o papel padrão (não-superadmin),
 * por isso a promoção é feita explicitamente aqui.
 */
async function newSuperadmin(client: PoolClient): Promise<string> {
  const userId = await newUser(client);
  await client.query(
    `UPDATE core.users SET role = 'superadmin' WHERE id = $1`,
    [userId],
  );
  return userId;
}

const namespaceArb = fc
  .tuple(
    fc.stringMatching(/^[a-z0-9_]+$/),
    fc.stringMatching(/^[a-z0-9_]+$/),
    fc.stringMatching(/^[a-z0-9_]+$/),
  )
  .map(([m, r, a]) => `${m}:${r}:${a}`);

describe("Autorização RBAC", () => {
  // Feature: central-contacts-and-module-contract, Property 25: Autorização por
  // posse de namespace — ação permitida sse o usuário possui o namespace; caso
  // contrário negada.
  it("Property 25: autoriza sse possui o namespace, nega caso contrário", async () => {
    await fc.assert(
      fc.asyncProperty(namespaceArb, namespaceArb, async (granted, other) => {
        fc.pre(granted !== other);
        await withRollback(async (client) => {
          const userId = await newUser(client);
          await grantNamespace(client, userId, granted);

          // Possui o concedido: autoriza.
          expect(await hasNamespace(client, userId, granted)).toBe(true);
          await expect(authorize(client, userId, granted)).resolves.toBeUndefined();

          // Não possui o outro: nega com RBAC_ACCESS_DENIED.
          expect(await hasNamespace(client, userId, other)).toBe(false);
          try {
            await authorize(client, userId, other);
            expect.unreachable("deveria negar sem o namespace");
          } catch (err) {
            expect(err).toBeInstanceOf(DomainError);
            expect((err as DomainError).code).toBe(ErrorCode.RBAC_ACCESS_DENIED);
          }
        });
      }),
      RUNS,
    );
  });

  // Feature: central-contacts-and-module-contract, Property 25 (cont.): sem
  // autenticação (userId nulo) a ação é sempre negada como não autorizada.
  it("Property 25: requisição não autenticada é rejeitada como AUTH_UNAUTHORIZED", async () => {
    await fc.assert(
      fc.asyncProperty(namespaceArb, async (ns) => {
        await withRollback(async (client) => {
          try {
            await authorize(client, null, ns);
            expect.unreachable("deveria rejeitar sem autenticação");
          } catch (err) {
            expect(err).toBeInstanceOf(DomainError);
            expect((err as DomainError).code).toBe(ErrorCode.AUTH_UNAUTHORIZED);
          }
        });
      }),
      RUNS,
    );
  });

  // Feature: superadmin-full-access, Property 1: Bug Condition — SuperAdministrador
  // tem acesso global. Para toda entrada onde a bug condition se mantém
  // (usuário autenticado com role='superadmin' e SEM o namespace exigido),
  // `authorize` DEVE autorizar (resolver sem lançar), independentemente do
  // conjunto concedido em core.user_permissions.
  //
  // NOTA (teste exploratório de bugfix): este teste codifica o comportamento
  // ESPERADO e por isso DEVE FALHAR no código NÃO corrigido — a falha
  // (RBAC_ACCESS_DENIED) confirma que o bug existe. Após a correção (tarefa 3.2),
  // este mesmo teste deve PASSAR.
  //
  // Validates: Requirements 2.1, 2.2, 2.3
  describe("Property 1: Bug Condition — SuperAdministrador tem acesso global", () => {
    it("autoriza superadmin sem grant para qualquer namespace gerado", async () => {
      await fc.assert(
        fc.asyncProperty(namespaceArb, async (ns) => {
          await withRollback(async (client) => {
            const userId = await newSuperadmin(client);
            // Bug Condition: superadmin autenticado SEM o namespace exigido.
            expect(await hasNamespace(client, userId, ns)).toBe(false);
            await expect(authorize(client, userId, ns)).resolves.toBeUndefined();
          });
        }),
        RUNS,
      );
    });

    it("autoriza superadmin para namespace fora de ALL_NAMESPACES (crm:novomodulo:acao)", async () => {
      await withRollback(async (client) => {
        const userId = await newSuperadmin(client);
        expect(await hasNamespace(client, userId, "crm:novomodulo:acao")).toBe(false);
        await expect(
          authorize(client, userId, "crm:novomodulo:acao"),
        ).resolves.toBeUndefined();
      });
    });

    it("autoriza superadmin para namespace do catálogo nunca concedido (core:backup:gerenciar)", async () => {
      await withRollback(async (client) => {
        const userId = await newSuperadmin(client);
        expect(await hasNamespace(client, userId, "core:backup:gerenciar")).toBe(false);
        await expect(
          authorize(client, userId, "core:backup:gerenciar"),
        ).resolves.toBeUndefined();
      });
    });
  });

  // Feature: superadmin-full-access, Property 2: Preservation — comportamento de
  // não-superadmin e não autenticados. Para toda entrada onde a bug condition NÃO
  // se mantém (¬C), `authorize` deve produzir exatamente o mesmo resultado da
  // função original: autoriza sse o usuário possui o namespace, nega com
  // RBAC_ACCESS_DENIED quando falta, e recusa com AUTH_UNAUTHORIZED quando userId
  // é nulo. Adicionalmente, o conjunto refletido em core.user_permissions para
  // usuários comuns permanece exato sob grant/revoke/setUserPermissions.
  //
  // NOTA (metodologia observation-first): estas asserções foram escritas após
  // observar o comportamento no código NÃO corrigido e DEVEM PASSAR nele —
  // confirmam o baseline a ser preservado pela correção. As dimensões 3.1/3.2/3.3
  // já são cobertas por P25; este bloco evita duplicação e adiciona cobertura
  // explícita de 3.4 (grant/revoke/setUserPermissions/listUserPermissions).
  //
  // Validates: Requirements 3.1, 3.2, 3.3, 3.4
  describe("Property 2: Preservation — não-superadmin e não autenticados", () => {
    // Req 3.1 e 3.2: reforço explícito de que o não-superadmin autoriza sse
    // possui o namespace e nega (RBAC_ACCESS_DENIED) caso contrário. Complementa
    // P25 focando o papel padrão criado por `newUser` (não-superadmin).
    it("Req 3.1/3.2: não-superadmin autoriza sse possui o namespace, nega caso contrário", async () => {
      await fc.assert(
        fc.asyncProperty(namespaceArb, namespaceArb, async (granted, other) => {
          fc.pre(granted !== other);
          await withRollback(async (client) => {
            const userId = await newUser(client);
            await grantNamespace(client, userId, granted);

            // COM o namespace concedido: autoriza (Req 3.1).
            await expect(
              authorize(client, userId, granted),
            ).resolves.toBeUndefined();

            // SEM o namespace: nega com RBAC_ACCESS_DENIED (Req 3.2).
            try {
              await authorize(client, userId, other);
              expect.unreachable("deveria negar sem o namespace");
            } catch (err) {
              expect(err).toBeInstanceOf(DomainError);
              expect((err as DomainError).code).toBe(ErrorCode.RBAC_ACCESS_DENIED);
            }
          });
        }),
        RUNS,
      );
    });

    // Req 3.3: requisição não autenticada (userId nulo) é sempre recusada com
    // AUTH_UNAUTHORIZED, independentemente do papel hipotético.
    it("Req 3.3: requisição não autenticada (userId nulo) recusa com AUTH_UNAUTHORIZED", async () => {
      await fc.assert(
        fc.asyncProperty(namespaceArb, async (ns) => {
          await withRollback(async (client) => {
            try {
              await authorize(client, null, ns);
              expect.unreachable("deveria recusar sem autenticação");
            } catch (err) {
              expect(err).toBeInstanceOf(DomainError);
              expect((err as DomainError).code).toBe(ErrorCode.AUTH_UNAUTHORIZED);
            }
          });
        }),
        RUNS,
      );
    });

    // Req 3.4: para um não-superadmin, após grant/revoke o conjunto refletido em
    // core.user_permissions (via listUserPermissions/hasNamespace) é exatamente o
    // conjunto concedido — nem mais, nem menos.
    it("Req 3.4: grant/revoke refletem exatamente o conjunto concedido do não-superadmin", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.uniqueArray(namespaceArb, { minLength: 1, maxLength: 6 }),
          async (namespaces) => {
            await withRollback(async (client) => {
              const userId = await newUser(client);

              // Concede todos: listUserPermissions reflete exatamente o conjunto.
              for (const ns of namespaces) await grantNamespace(client, userId, ns);
              expect([...(await listUserPermissions(client, userId))].sort()).toEqual(
                [...namespaces].sort(),
              );
              for (const ns of namespaces) {
                expect(await hasNamespace(client, userId, ns)).toBe(true);
              }

              // Revoga o primeiro: some do conjunto; os demais permanecem.
              const [revoked, ...rest] = namespaces;
              await revokeNamespace(client, userId, revoked!);
              expect([...(await listUserPermissions(client, userId))].sort()).toEqual(
                [...rest].sort(),
              );
              expect(await hasNamespace(client, userId, revoked!)).toBe(false);
            });
          },
        ),
        RUNS,
      );
    });

    // Req 3.4: setUserPermissions substitui o conjunto pelo desejado (concede os
    // que faltam, revoga os que sobram); listUserPermissions reflete exatamente o
    // conjunto final para um não-superadmin.
    it("Req 3.4: setUserPermissions substitui pelo conjunto desejado exato do não-superadmin", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.uniqueArray(namespaceArb, { maxLength: 6 }),
          fc.uniqueArray(namespaceArb, { maxLength: 6 }),
          async (initial, desired) => {
            await withRollback(async (client) => {
              const userId = await newUser(client);

              await setUserPermissions(client, userId, initial);
              expect([...(await listUserPermissions(client, userId))].sort()).toEqual(
                [...initial].sort(),
              );

              // Substitui pelo conjunto desejado: reflete exatamente `desired`.
              await setUserPermissions(client, userId, desired);
              expect([...(await listUserPermissions(client, userId))].sort()).toEqual(
                [...desired].sort(),
              );
              // hasNamespace concorda com a pertinência ao conjunto desejado.
              for (const ns of initial) {
                expect(await hasNamespace(client, userId, ns)).toBe(
                  desired.includes(ns),
                );
              }
            });
          },
        ),
        RUNS,
      );
    });
  });

  // Feature: superadmin-full-access, Tarefa 4 — testes unitários complementares.
  // Cobrem lacunas não endereçadas pelas properties: o contrato do helper
  // `isSuperadmin` isoladamente, um namespace comprovadamente ausente de
  // ALL_NAMESPACES (Req 2.3) e a precedência da checagem de autenticação sobre
  // a consulta de papel (Req 3.3).
  describe("Unit (Tarefa 4): isSuperadmin e casos de borda de authorize", () => {
    // isSuperadmin retorna true para papel superadmin, false para outros papéis
    // e false para userId nulo.
    it("isSuperadmin: true p/ superadmin, false p/ outro papel, false p/ userId nulo", async () => {
      await withRollback(async (client) => {
        const superId = await newSuperadmin(client);
        const commonId = await newUser(client);

        expect(await isSuperadmin(client, superId)).toBe(true);
        expect(await isSuperadmin(client, commonId)).toBe(false);
        expect(await isSuperadmin(client, null)).toBe(false);
      });
    });

    // Req 2.3: authorize autoriza superadmin para um namespace comprovadamente
    // ausente do catálogo ALL_NAMESPACES (nunca poderia ter sido concedido no
    // bootstrap). Escolhe-se um namespace único garantido fora do catálogo.
    it("Req 2.3: authorize autoriza superadmin p/ namespace ausente de ALL_NAMESPACES", async () => {
      await withRollback(async (client) => {
        const userId = await newSuperadmin(client);
        const ns = `modulo_inexistente:recurso_novo:acao_${Math.random().toString(36).slice(2)}`;
        // Garante que o namespace realmente não está no catálogo nem concedido.
        expect(ALL_NAMESPACES.includes(ns)).toBe(false);
        expect(await hasNamespace(client, userId, ns)).toBe(false);

        await expect(authorize(client, userId, ns)).resolves.toBeUndefined();
      });
    });

    // Req 3.3: userId nulo é recusado com AUTH_UNAUTHORIZED antes de qualquer
    // consulta de papel — mesmo existindo um superadmin no banco, a ausência de
    // autenticação prevalece (a ordem das checagens é preservada).
    it("Req 3.3: authorize recusa userId nulo com AUTH_UNAUTHORIZED mesmo com superadmin presente", async () => {
      await withRollback(async (client) => {
        // Existe um superadmin no banco, mas a requisição não está autenticada.
        await newSuperadmin(client);
        try {
          await authorize(client, null, "core:backup:gerenciar");
          expect.unreachable("deveria recusar sem autenticação");
        } catch (err) {
          expect(err).toBeInstanceOf(DomainError);
          expect((err as DomainError).code).toBe(ErrorCode.AUTH_UNAUTHORIZED);
        }
      });
    });
  });

  it("exemplo (Req 10.5): grant é idempotente", async () => {
    await withRollback(async (client) => {
      const userId = await newUser(client);
      await grantNamespace(client, userId, "crm:leads:visualizar");
      await grantNamespace(client, userId, "crm:leads:visualizar");
      const { rows } = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM core.user_permissions WHERE user_id = $1`,
        [userId],
      );
      expect(rows[0]?.count).toBe("1");
    });
  });
});
