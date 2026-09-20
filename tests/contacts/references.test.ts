import { describe, it, expect, afterAll } from "vitest";
import fc from "fast-check";
import type { PoolClient } from "pg";
import { withRollback, closeTestPool } from "../helpers/db.js";
import { createContact, deleteContact } from "../../src/core/contacts/contact-service.js";
import {
  registerReference,
  removeReference,
  listModulesReferencing,
  hasActiveReferences,
} from "../../src/core/contacts/reference-service.js";
import { DomainError, ErrorCode } from "../../src/core/errors.js";
import { randomUUID } from "node:crypto";

/**
 * @file references.test.ts
 *
 * Testes das referências de módulo e proteção de exclusão (Tarefa 6).
 * Cobre P17 (referência exige contato existente) e P18 (exclusão bloqueada
 * por referências ativas, com a lista de módulos).
 */

const RUNS = { numRuns: 100 } as const;

afterAll(async () => {
  await closeTestPool();
});

/** Cria uma pessoa e retorna seu id. */
async function newPerson(client: PoolClient): Promise<string> {
  const c = await createContact(client, {
    contact_type: "pessoa",
    full_name: "Contato Ref",
    email: `ref${Math.random().toString(36).slice(2)}@example.com`,
    phone: "11999990000",
  });
  return c.id;
}

/** Gera um nome de módulo no padrão mod_[nome]. */
const moduleArb = fc
  .string({ minLength: 1, maxLength: 10 })
  .map((s) => `mod_${s.replace(/[^a-z0-9]/gi, "x").toLowerCase() || "x"}`);

const tableArb = fc
  .string({ minLength: 1, maxLength: 10 })
  .map((s) => s.replace(/[^a-z0-9_]/gi, "x").toLowerCase() || "t");

describe("Referências de módulo e proteção de exclusão", () => {
  // Feature: central-contacts-and-module-contract, Property 17: Referência
  // exige contato existente — registrar uma Referencia_Contato é aceito sse o
  // contato existe; caso contrário é rejeitado com mensagem descritiva.
  it("Property 17: referência a contato existente é aceita; a inexistente é rejeitada", async () => {
    await fc.assert(
      fc.asyncProperty(moduleArb, tableArb, async (module, table) => {
        await withRollback(async (client) => {
          // Existente: aceito e registrado.
          const contactId = await newPerson(client);
          await registerReference(client, module, table, contactId);
          expect(await hasActiveReferences(client, contactId)).toBe(true);

          // Inexistente: rejeitado.
          const ghost = randomUUID();
          try {
            await registerReference(client, module, table, ghost);
            expect.unreachable("deveria rejeitar referência a contato inexistente");
          } catch (err) {
            expect(err).toBeInstanceOf(DomainError);
            expect((err as DomainError).code).toBe(ErrorCode.REFERENCE_CONTACT_NOT_FOUND);
          }
        });
      }),
      RUNS,
    );
  });

  // Feature: central-contacts-and-module-contract, Property 18: Exclusão
  // bloqueada por referências ativas — exclusão permitida sse não há referência
  // ativa; havendo, é bloqueada e a resposta contém exatamente a lista de
  // módulos que referenciam o contato.
  it("Property 18: exclusão é bloqueada com referências e a lista de módulos é exata", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(moduleArb, { minLength: 1, maxLength: 4 }),
        tableArb,
        async (modules, table) => {
          await withRollback(async (client) => {
            const contactId = await newPerson(client);
            for (const m of modules) {
              await registerReference(client, m, table, contactId);
            }

            try {
              await deleteContact(client, contactId);
              expect.unreachable("deveria bloquear exclusão de contato referenciado");
            } catch (err) {
              expect(err).toBeInstanceOf(DomainError);
              const de = err as DomainError;
              expect(de.code).toBe(ErrorCode.CONTACT_HAS_REFERENCES);
              expect(new Set(de.details.modules as string[])).toEqual(new Set(modules));
            }
          });
        },
      ),
      RUNS,
    );
  });

  it("Property 18: exclusão é permitida quando não há referências ativas", async () => {
    await fc.assert(
      fc.asyncProperty(moduleArb, tableArb, async (module, table) => {
        await withRollback(async (client) => {
          const contactId = await newPerson(client);
          // Registra e depois remove a referência: contato fica sem refs.
          await registerReference(client, module, table, contactId);
          await removeReference(client, module, table, contactId);
          expect(await hasActiveReferences(client, contactId)).toBe(false);

          await deleteContact(client, contactId);
          const { rows } = await client.query<{ count: string }>(
            `SELECT count(*)::text AS count FROM core.contacts WHERE id = $1`,
            [contactId],
          );
          expect(rows[0]?.count).toBe("0");
        });
      }),
      RUNS,
    );
  });

  it("exemplo (Req 7.1): registro de referência é idempotente", async () => {
    await withRollback(async (client) => {
      const contactId = await newPerson(client);
      await registerReference(client, "mod_crm", "leads", contactId);
      await registerReference(client, "mod_crm", "leads", contactId);
      const { rows } = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM core.contact_references WHERE contact_id = $1`,
        [contactId],
      );
      expect(rows[0]?.count).toBe("1");
      expect(await listModulesReferencing(client, contactId)).toEqual(["mod_crm"]);
    });
  });
});
