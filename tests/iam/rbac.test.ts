import { describe, it, expect, afterAll } from "vitest";
import fc from "fast-check";
import type { PoolClient } from "pg";
import { withRollback, closeTestPool } from "../helpers/db.js";
import { grantNamespace, hasNamespace, authorize } from "../../src/core/iam/rbac.js";
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
