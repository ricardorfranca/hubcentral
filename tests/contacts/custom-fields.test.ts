import { describe, it, expect, afterAll } from "vitest";
import fc from "fast-check";
import type { PoolClient } from "pg";
import { withRollback, closeTestPool } from "../helpers/db.js";
import { createContact } from "../../src/core/contacts/contact-service.js";
import {
  defineCustomField,
  setCustomFieldValue,
  findContactsByCustomField,
  isValueOfType,
  type CustomFieldDataType,
} from "../../src/core/contacts/custom-field-service.js";
import { DomainError, ErrorCode } from "../../src/core/errors.js";

/**
 * @file custom-fields.test.ts
 *
 * Testes dos campos personalizados (Tarefa 5). Cobre P10 (round-trip de valor)
 * e P11 (validação de valor contra o tipo), mais o exemplo de definição (Req 4.1).
 */

const RUNS = { numRuns: 100 } as const;

afterAll(async () => {
  await closeTestPool();
});

/** Cria uma pessoa e retorna seu id. */
async function newPerson(client: PoolClient): Promise<string> {
  const c = await createContact(client, {
    contact_type: "pessoa",
    full_name: "Contato Campo",
    email: `cf${Math.random().toString(36).slice(2)}@example.com`,
    phone: "11999990000",
  });
  return c.id;
}

/** Gera um valor VÁLIDO para um dado tipo. */
function validValueArb(dataType: CustomFieldDataType): fc.Arbitrary<unknown> {
  switch (dataType) {
    case "text":
      return fc.string({ maxLength: 60 });
    case "number":
      return fc.oneof(
        fc.integer(),
        fc.float({ noNaN: true, noDefaultInfinity: true }),
      );
    case "boolean":
      return fc.boolean();
    case "date":
      return fc
        .date({ min: new Date("1970-01-01"), max: new Date("2100-12-31") })
        .map((d) => d.toISOString().slice(0, 10));
  }
}

/** Nome de campo não vazio e sem espaços nas bordas. */
const fieldNameArb = fc
  .string({ minLength: 1, maxLength: 40 })
  .map((s) => s.replace(/\s+/g, "_"))
  .filter((s) => s.trim().length > 0);

const dataTypeArb = fc.constantFrom<CustomFieldDataType>("text", "number", "boolean", "date");

describe("Campos personalizados", () => {
  it("exemplo (Req 4.1): define um campo com nome e tipo", async () => {
    await withRollback(async (client) => {
      const def = await defineCustomField(client, "escola_dos_filhos", "text");
      expect(def.name.toLowerCase()).toBe("escola_dos_filhos");
      expect(def.data_type).toBe("text");
    });
  });

  // Feature: central-contacts-and-module-contract, Property 10: Round-trip de
  // valor de campo personalizado — após atribuir um valor válido a um contato,
  // consultar por esse valor retorna o contato.
  it("Property 10: round-trip — valor atribuído é recuperável por consulta", async () => {
    await fc.assert(
      fc.asyncProperty(
        fieldNameArb,
        dataTypeArb.chain((dt) => fc.tuple(fc.constant(dt), validValueArb(dt))),
        async (fieldName, [dataType, value]) => {
          await withRollback(async (client) => {
            const contactId = await newPerson(client);
            const def = await defineCustomField(client, fieldName, dataType);
            await setCustomFieldValue(client, contactId, def.id, value);

            const found = await findContactsByCustomField(client, def.id, value);
            expect(found).toContain(contactId);
          });
        },
      ),
      RUNS,
    );
  });

  // Feature: central-contacts-and-module-contract, Property 11: Validação de
  // valor contra o tipo do campo — a atribuição é aceita sse o valor conforma
  // ao data_type; caso contrário é rejeitada com CUSTOM_FIELD_TYPE_MISMATCH.
  it("Property 11: aceita valor conforme o tipo e rejeita valor não-conforme", async () => {
    // Gera um valor arbitrário de QUALQUER tipo primitivo e verifica que a
    // aceitação do serviço coincide com isValueOfType (oráculo).
    const anyPrimitive = fc.oneof(
      fc.string({ maxLength: 30 }),
      fc.integer(),
      fc.float({ noNaN: true, noDefaultInfinity: true }),
      fc.boolean(),
      // data ISO como string (pode ou não bater com o tipo 'date')
      fc.date({ min: new Date("1970-01-01"), max: new Date("2100-12-31") }).map((d) =>
        d.toISOString().slice(0, 10),
      ),
    );

    await fc.assert(
      fc.asyncProperty(fieldNameArb, dataTypeArb, anyPrimitive, async (fieldName, dataType, value) => {
        await withRollback(async (client) => {
          const contactId = await newPerson(client);
          const def = await defineCustomField(client, fieldName, dataType);
          const shouldAccept = isValueOfType(dataType, value);

          if (shouldAccept) {
            await setCustomFieldValue(client, contactId, def.id, value);
            const found = await findContactsByCustomField(client, def.id, value);
            expect(found).toContain(contactId);
          } else {
            try {
              await setCustomFieldValue(client, contactId, def.id, value);
              expect.unreachable("deveria rejeitar valor não-conforme ao tipo");
            } catch (err) {
              expect(err).toBeInstanceOf(DomainError);
              const de = err as DomainError;
              expect(de.code).toBe(ErrorCode.CUSTOM_FIELD_TYPE_MISMATCH);
              expect(de.details.expected_type).toBe(dataType);
            }
          }
        });
      }),
      RUNS,
    );
  });

  it("Property 11: rejeita data de calendário inválida (2026-02-31)", async () => {
    await withRollback(async (client) => {
      const contactId = await newPerson(client);
      const def = await defineCustomField(client, "aniversario", "date");
      try {
        await setCustomFieldValue(client, contactId, def.id, "2026-02-31");
        expect.unreachable("deveria rejeitar data inexistente");
      } catch (err) {
        expect((err as DomainError).code).toBe(ErrorCode.CUSTOM_FIELD_TYPE_MISMATCH);
      }
    });
  });
});
