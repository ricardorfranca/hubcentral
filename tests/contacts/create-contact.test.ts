import { describe, it, expect, afterAll } from "vitest";
import fc from "fast-check";
import { withRollback, closeTestPool } from "../helpers/db.js";
import {
  personInputArb,
  companyInputArb,
  validEmailArb,
  invalidEmailArb,
} from "../helpers/arbitraries.js";
import { createContact } from "../../src/core/contacts/contact-service.js";
import { DomainError, ErrorCode } from "../../src/core/errors.js";
import type { PersonContactInput } from "../../src/core/contacts/types.js";

/**
 * @file create-contact.test.ts
 *
 * Testes da criação de contato (Tarefa 2.2). Cobre as propriedades de correção
 * P1, P2, P3 e P12 do design, mais um teste de exemplo para persistência de
 * contact_type (Req 1.2). Cada propriedade roda com numRuns:100 e isola o
 * estado do banco via withRollback.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RUNS = { numRuns: 100 } as const;

afterAll(async () => {
  await closeTestPool();
});

describe("ContactService.createContact", () => {
  // Feature: central-contacts-and-module-contract, Property 1: Identidade única
  // do contato — cada contato criado recebe exatamente um contact_id UUID
  // distinto e é persistido como um único registro em core.contacts.
  it("Property 1: cada contato criado recebe um UUID único e é um único registro", async () => {
    await fc.assert(
      fc.asyncProperty(personInputArb, companyInputArb, async (person, company) => {
        await withRollback(async (client) => {
          const c1 = await createContact(client, person);
          const c2 = await createContact(client, company);

          expect(c1.id).toMatch(UUID_RE);
          expect(c2.id).toMatch(UUID_RE);
          expect(c1.id).not.toBe(c2.id);

          const { rows } = await client.query<{ count: string }>(
            `SELECT count(*)::text AS count FROM core.contacts WHERE id = ANY($1::uuid[])`,
            [[c1.id, c2.id]],
          );
          expect(rows[0]?.count).toBe("2");
        });
      }),
      RUNS,
    );
  });

  // Feature: central-contacts-and-module-contract, Property 2: Completude de
  // campos obrigatórios por tipo — a criação é aceita sse e somente se todos os
  // campos obrigatórios do contact_type estão presentes; faltando, rejeita e a
  // mensagem identifica o campo ausente.
  it("Property 2: criação rejeita quando falta campo obrigatório, identificando o campo", async () => {
    const fields = ["full_name", "email", "phone"] as const;
    await fc.assert(
      fc.asyncProperty(
        personInputArb,
        fc.constantFrom(...fields),
        async (person, missingField) => {
          const broken = { ...person, [missingField]: "" } as PersonContactInput;
          await withRollback(async (client) => {
            try {
              await createContact(client, broken);
              expect.unreachable("deveria ter rejeitado por campo ausente");
            } catch (err) {
              expect(err).toBeInstanceOf(DomainError);
              const de = err as DomainError;
              expect(de.code).toBe(ErrorCode.CONTACT_MISSING_FIELD);
              expect(de.details.field).toBe(missingField);
            }
          });
        },
      ),
      RUNS,
    );
  });

  // Feature: central-contacts-and-module-contract, Property 3: Validação de
  // e-mail — a criação é aceita se e somente se o e-mail casa com o padrão.
  it("Property 3: e-mail válido é aceito e e-mail inválido é rejeitado", async () => {
    await fc.assert(
      fc.asyncProperty(personInputArb, validEmailArb, async (person, email) => {
        await withRollback(async (client) => {
          const created = await createContact(client, { ...person, email });
          expect(created.email?.toLowerCase()).toBe(email.toLowerCase());
        });
      }),
      RUNS,
    );

    await fc.assert(
      fc.asyncProperty(personInputArb, invalidEmailArb, async (person, badEmail) => {
        await withRollback(async (client) => {
          try {
            await createContact(client, { ...person, email: badEmail });
            expect.unreachable("deveria ter rejeitado e-mail inválido");
          } catch (err) {
            expect(err).toBeInstanceOf(DomainError);
            expect((err as DomainError).code).toBe(ErrorCode.CONTACT_INVALID_EMAIL);
          }
        });
      }),
      RUNS,
    );
  });

  // Feature: central-contacts-and-module-contract, Property 12: Deduplicação
  // por chave natural — criar outro contato do mesmo tipo com a mesma chave
  // natural (e-mail p/ pessoa, documento p/ empresa; case-insensitive) é
  // rejeitado e a mensagem contém o contact_id do contato existente.
  it("Property 12: pessoa duplicada por e-mail (case-insensitive) é rejeitada com existing_contact_id", async () => {
    await fc.assert(
      fc.asyncProperty(personInputArb, async (person) => {
        await withRollback(async (client) => {
          const first = await createContact(client, person);
          const dupEmail = person.email.toUpperCase();
          try {
            await createContact(client, { ...person, email: dupEmail });
            expect.unreachable("deveria ter rejeitado duplicidade de e-mail");
          } catch (err) {
            expect(err).toBeInstanceOf(DomainError);
            const de = err as DomainError;
            expect(de.code).toBe(ErrorCode.CONTACT_DUPLICATE_EMAIL);
            expect(de.details.existing_contact_id).toBe(first.id);
          }
        });
      }),
      RUNS,
    );
  });

  it("Property 12: empresa duplicada por documento (case-insensitive) é rejeitada com existing_contact_id", async () => {
    await fc.assert(
      fc.asyncProperty(companyInputArb, async (company) => {
        await withRollback(async (client) => {
          const first = await createContact(client, company);
          const dupDoc = company.fiscal_document.toUpperCase();
          try {
            await createContact(client, { ...company, fiscal_document: dupDoc });
            expect.unreachable("deveria ter rejeitado duplicidade de documento");
          } catch (err) {
            expect(err).toBeInstanceOf(DomainError);
            const de = err as DomainError;
            expect(de.code).toBe(ErrorCode.CONTACT_DUPLICATE_DOCUMENT);
            expect(de.details.existing_contact_id).toBe(first.id);
          }
        });
      }),
      RUNS,
    );
  });

  it("exemplo (Req 1.2): persiste o contact_type informado", async () => {
    await withRollback(async (client) => {
      const person = await createContact(client, {
        contact_type: "pessoa",
        full_name: "Ana Souza",
        email: "ana@example.com",
        phone: "11999990000",
      });
      const company = await createContact(client, {
        contact_type: "empresa",
        legal_name: "Acme Ltda",
        fiscal_document: "12345678000199",
      });
      expect(person.contact_type).toBe("pessoa");
      expect(company.contact_type).toBe("empresa");
    });
  });
});
