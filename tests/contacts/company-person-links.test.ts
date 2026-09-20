import { describe, it, expect, afterAll } from "vitest";
import fc from "fast-check";
import { withRollback, closeTestPool } from "../helpers/db.js";
import { personInputArb, companyInputArb } from "../helpers/arbitraries.js";
import { createContact } from "../../src/core/contacts/contact-service.js";
import {
  linkCompanyPerson,
  getCompaniesOfPerson,
} from "../../src/core/contacts/link-service.js";
import { DomainError, ErrorCode } from "../../src/core/errors.js";
import type { PoolClient } from "pg";

/**
 * @file company-person-links.test.ts
 *
 * Testes dos vínculos empresa↔pessoa (Tarefa 3.2). Cobre P4 (round-trip),
 * P5 (respeito ao tipo dos lados) e P6 (unicidade/idempotência).
 */

const RUNS = { numRuns: 100 } as const;

afterAll(async () => {
  await closeTestPool();
});

/** Cria uma pessoa e retorna seu id. */
async function newPerson(client: PoolClient, seed: number): Promise<string> {
  const c = await createContact(client, {
    contact_type: "pessoa",
    full_name: `Pessoa ${seed}`,
    email: `pessoa${seed}@example.com`,
    phone: "11999990000",
  });
  return c.id;
}

/** Cria uma empresa e retorna seu id. */
async function newCompany(client: PoolClient, seed: number): Promise<string> {
  const c = await createContact(client, {
    contact_type: "empresa",
    legal_name: `Empresa ${seed}`,
    fiscal_document: `doc-${seed}`,
  });
  return c.id;
}

describe("Vínculos empresa↔pessoa", () => {
  // Feature: central-contacts-and-module-contract, Property 4: Round-trip de
  // vínculo empresa↔pessoa — após vincular pessoas a uma empresa, consultar
  // cada pessoa retorna exatamente as empresas às quais foi vinculada.
  it("Property 4: round-trip — consultar a pessoa retorna as empresas vinculadas", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 5 }),
        fc.option(fc.string({ minLength: 1, maxLength: 100 }), { nil: undefined }),
        async (numCompanies, role) => {
          await withRollback(async (client) => {
            const personId = await newPerson(client, Date.now() + Math.random());
            const companyIds: string[] = [];
            for (let i = 0; i < numCompanies; i++) {
              const companyId = await newCompany(client, `${Date.now()}-${i}-${Math.random()}`);
              companyIds.push(companyId);
              await linkCompanyPerson(client, companyId, personId, role);
            }
            const linked = await getCompaniesOfPerson(client, personId);
            expect(new Set(linked)).toEqual(new Set(companyIds));
            expect(linked).toHaveLength(companyIds.length);
          });
        },
      ),
      RUNS,
    );
  });

  it("Property 4: papel informado é preservado no vínculo", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim() !== ""),
        async (role) => {
          await withRollback(async (client) => {
            const personId = await newPerson(client, Math.random());
            const companyId = await newCompany(client, Math.random());
            const link = await linkCompanyPerson(client, companyId, personId, role);
            expect(link.role).toBe(role);
          });
        },
      ),
      RUNS,
    );
  });

  // Feature: central-contacts-and-module-contract, Property 5: Vínculo respeita
  // o tipo dos lados — rejeita se o lado empresa não é empresa (ou o lado
  // pessoa não é pessoa).
  it("Property 5: rejeita vínculo quando os lados têm o tipo trocado", async () => {
    await fc.assert(
      fc.asyncProperty(personInputArb, companyInputArb, async (_p, _c) => {
        await withRollback(async (client) => {
          const personId = await newPerson(client, Math.random());
          const companyId = await newCompany(client, Math.random());

          // Lados trocados: passando pessoa como empresa e empresa como pessoa.
          try {
            await linkCompanyPerson(client, personId, companyId);
            expect.unreachable("deveria rejeitar lado empresa inválido");
          } catch (err) {
            expect(err).toBeInstanceOf(DomainError);
            expect((err as DomainError).code).toBe(ErrorCode.LINK_INVALID_COMPANY);
          }

          // Empresa correta como empresa, mas pessoa é outra empresa.
          const otherCompanyId = await newCompany(client, Math.random());
          try {
            await linkCompanyPerson(client, companyId, otherCompanyId);
            expect.unreachable("deveria rejeitar lado pessoa inválido");
          } catch (err) {
            expect(err).toBeInstanceOf(DomainError);
            expect((err as DomainError).code).toBe(ErrorCode.LINK_INVALID_PERSON);
          }
        });
      }),
      RUNS,
    );
  });

  // Feature: central-contacts-and-module-contract, Property 6: Vínculo é único
  // por par (idempotência) — recriar o mesmo vínculo é rejeitado e o número de
  // vínculos entre o par permanece 1.
  it("Property 6: vínculo duplicado é rejeitado e a contagem do par permanece 1", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: undefined }),
        async (role) => {
          await withRollback(async (client) => {
            const personId = await newPerson(client, Math.random());
            const companyId = await newCompany(client, Math.random());

            await linkCompanyPerson(client, companyId, personId, role);
            try {
              await linkCompanyPerson(client, companyId, personId, role);
              expect.unreachable("deveria rejeitar vínculo duplicado");
            } catch (err) {
              expect(err).toBeInstanceOf(DomainError);
              expect((err as DomainError).code).toBe(ErrorCode.LINK_DUPLICATE);
            }

            const { rows } = await client.query<{ count: string }>(
              `SELECT count(*)::text AS count FROM core.contact_company_links
               WHERE company_id = $1 AND person_id = $2`,
              [companyId, personId],
            );
            expect(rows[0]?.count).toBe("1");
          });
        },
      ),
      RUNS,
    );
  });

  it("exemplo (Req 2.6): pessoa sem vínculos retorna coleção vazia", async () => {
    await withRollback(async (client) => {
      const personId = await newPerson(client, Math.random());
      const linked = await getCompaniesOfPerson(client, personId);
      expect(linked).toEqual([]);
    });
  });
});
