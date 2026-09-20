import { describe, it, expect, afterAll } from "vitest";
import fc from "fast-check";
import type { PoolClient } from "pg";
import { withRollback, getTestPool, closeTestPool } from "../helpers/db.js";
import { createContact } from "../../src/core/contacts/contact-service.js";
import {
  createCustomCategory,
  listCategories,
  assignCategory,
  listContactsByCategory,
  SYSTEM_CATEGORIES,
} from "../../src/core/contacts/category-service.js";
import { DomainError, ErrorCode } from "../../src/core/errors.js";

/**
 * @file categories.test.ts
 *
 * Testes da categorização de contatos (Tarefa 4). Cobre P7 (round-trip +
 * filtragem), P8 (categoria customizada disponível) e P9 (unicidade
 * case-insensitive), mais o exemplo do seed das 5 categorias de sistema.
 */

const RUNS = { numRuns: 100 } as const;

/** Gera um nome de categoria não vazio e sem espaços nas bordas. */
const categoryNameArb = fc
  .string({ minLength: 1, maxLength: 40 })
  .map((s) => s.replace(/\s+/g, "_"))
  .filter((s) => s.trim().length > 0);

afterAll(async () => {
  await closeTestPool();
});

/** Cria uma pessoa e retorna seu id. */
async function newPerson(client: PoolClient): Promise<string> {
  const c = await createContact(client, {
    contact_type: "pessoa",
    full_name: "Contato Categoria",
    email: `cat${Math.random().toString(36).slice(2)}@example.com`,
    phone: "11999990000",
  });
  return c.id;
}

describe("Categorização de contatos", () => {
  it("exemplo (Req 3.1): as 5 categorias de sistema existem após o seed", async () => {
    const { rows } = await getTestPool().query<{ name: string }>(
      `SELECT name FROM core.contact_categories WHERE is_system = true ORDER BY name`,
    );
    expect(new Set(rows.map((r) => r.name))).toEqual(new Set(SYSTEM_CATEGORIES));
  });

  // Feature: central-contacts-and-module-contract, Property 7: Round-trip de
  // categoria e filtragem — associar categorias a um contato e filtrar por
  // qualquer subconjunto inclui o contato; filtrar por categoria não associada
  // o exclui.
  it("Property 7: round-trip e filtragem por categoria", async () => {
    await fc.assert(
      fc.asyncProperty(categoryNameArb, categoryNameArb, async (nameA, nameB) => {
        fc.pre(nameA.toLowerCase() !== nameB.toLowerCase());
        await withRollback(async (client) => {
          const contactId = await newPerson(client);
          const catA = await createCustomCategory(client, nameA);
          const catB = await createCustomCategory(client, nameB);

          // Associa apenas a categoria A.
          await assignCategory(client, contactId, catA.id);

          const byA = await listContactsByCategory(client, [catA.id]);
          expect(byA).toContain(contactId);

          const byB = await listContactsByCategory(client, [catB.id]);
          expect(byB).not.toContain(contactId);
        });
      }),
      RUNS,
    );
  });

  it("Property 7: contato aparece ao filtrar por qualquer subconjunto de suas categorias", async () => {
    await fc.assert(
      fc.asyncProperty(categoryNameArb, categoryNameArb, async (nameA, nameB) => {
        fc.pre(nameA.toLowerCase() !== nameB.toLowerCase());
        await withRollback(async (client) => {
          const contactId = await newPerson(client);
          const catA = await createCustomCategory(client, nameA);
          const catB = await createCustomCategory(client, nameB);
          await assignCategory(client, contactId, catA.id);
          await assignCategory(client, contactId, catB.id);

          expect(await listContactsByCategory(client, [catA.id])).toContain(contactId);
          expect(await listContactsByCategory(client, [catB.id])).toContain(contactId);
          expect(await listContactsByCategory(client, [catA.id, catB.id])).toContain(contactId);
        });
      }),
      RUNS,
    );
  });

  // Feature: central-contacts-and-module-contract, Property 8: Categoria
  // customizada criada fica disponível — para qualquer nome não conflitante,
  // criar a categoria a torna disponível para associação e listagem.
  it("Property 8: categoria customizada criada fica disponível na listagem", async () => {
    await fc.assert(
      fc.asyncProperty(categoryNameArb, async (name) => {
        await withRollback(async (client) => {
          const created = await createCustomCategory(client, name);
          expect(created.is_system).toBe(false);

          const all = await listCategories(client);
          const found = all.find((c) => c.id === created.id);
          expect(found).toBeDefined();
          expect(found?.name.toLowerCase()).toBe(name.toLowerCase());

          // Disponível para associação a um contato.
          const contactId = await newPerson(client);
          await assignCategory(client, contactId, created.id);
          expect(await listContactsByCategory(client, [created.id])).toContain(contactId);
        });
      }),
      RUNS,
    );
  });

  // Feature: central-contacts-and-module-contract, Property 9: Unicidade de
  // nome de categoria (case-insensitive) — criar categoria com nome idêntico
  // ignorando caixa é rejeitado com mensagem descritiva.
  it("Property 9: nome de categoria duplicado (case-insensitive) é rejeitado", async () => {
    await fc.assert(
      fc.asyncProperty(categoryNameArb, async (name) => {
        await withRollback(async (client) => {
          const first = await createCustomCategory(client, name);
          const swapped = swapCase(name);
          try {
            await createCustomCategory(client, swapped);
            expect.unreachable("deveria rejeitar nome de categoria duplicado");
          } catch (err) {
            expect(err).toBeInstanceOf(DomainError);
            const de = err as DomainError;
            expect(de.code).toBe(ErrorCode.CATEGORY_DUPLICATE_NAME);
            expect(de.details.existing_category_id).toBe(first.id);
          }
        });
      }),
      RUNS,
    );
  });

  it("Property 9: nome idêntico a uma categoria de sistema é rejeitado", async () => {
    await withRollback(async (client) => {
      try {
        await createCustomCategory(client, "LEAD_FRIO");
        expect.unreachable("deveria rejeitar colisão com categoria de sistema");
      } catch (err) {
        expect(err).toBeInstanceOf(DomainError);
        expect((err as DomainError).code).toBe(ErrorCode.CATEGORY_DUPLICATE_NAME);
      }
    });
  });
});

/**
 * Inverte a caixa de cada letra da string, garantindo um valor textualmente
 * diferente mas case-insensitively igual (para exercitar a unicidade CITEXT).
 *
 * @param s - String de entrada.
 * @returns A string com a caixa das letras invertida.
 */
function swapCase(s: string): string {
  return [...s]
    .map((ch) => (ch === ch.toLowerCase() ? ch.toUpperCase() : ch.toLowerCase()))
    .join("");
}
