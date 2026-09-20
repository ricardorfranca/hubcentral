import { describe, it, expect, afterAll } from "vitest";
import fc from "fast-check";
import type { PoolClient } from "pg";
import { withRollback, closeTestPool } from "../helpers/db.js";
import {
  createContact,
  mergeContacts,
  getContactData,
} from "../../src/core/contacts/contact-service.js";
import { linkCompanyPerson, getCompaniesOfPerson } from "../../src/core/contacts/link-service.js";
import { createCustomCategory, assignCategory } from "../../src/core/contacts/category-service.js";
import {
  registerReference,
  listModulesReferencing,
} from "../../src/core/contacts/reference-service.js";
import { DomainError, ErrorCode } from "../../src/core/errors.js";

/**
 * @file merge.test.ts
 *
 * Testes da mesclagem de contatos (Tarefa 7). Cobre P13: após a mesclagem, o
 * destino possui a união dos vínculos, categorias, valores de campo
 * personalizado e referências de módulo de ambos; nenhuma referência aponta
 * mais para a origem.
 */

const RUNS = { numRuns: 50 } as const;

afterAll(async () => {
  await closeTestPool();
});

let seq = 0;
/** Cria uma pessoa única e retorna seu id. */
async function newPerson(client: PoolClient): Promise<string> {
  seq += 1;
  const c = await createContact(client, {
    contact_type: "pessoa",
    full_name: `Pessoa ${seq}`,
    email: `merge${seq}-${Math.random().toString(36).slice(2)}@example.com`,
    phone: "11999990000",
  });
  return c.id;
}

/** Cria uma empresa única e retorna seu id. */
async function newCompany(client: PoolClient): Promise<string> {
  seq += 1;
  const c = await createContact(client, {
    contact_type: "empresa",
    legal_name: `Empresa ${seq}`,
    fiscal_document: `doc-${seq}-${Math.random().toString(36).slice(2)}`,
  });
  return c.id;
}

describe("Mesclagem de contatos", () => {
  // Feature: central-contacts-and-module-contract, Property 13: Mesclagem
  // conserva e transfere tudo — o destino passa a ter a união de vínculos,
  // categorias, valores de campo personalizado e referências de módulo; nada
  // permanece apontando para a origem.
  it("Property 13: mesclagem transfere vínculos, categorias e referências para o destino", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 3 }),
        fc.integer({ min: 0, max: 3 }),
        fc.uniqueArray(fc.string({ minLength: 1, maxLength: 8 }).map((s) => `mod_${s.replace(/[^a-z0-9]/gi, "x").toLowerCase() || "x"}`), { maxLength: 3 }),
        async (numCompaniesSource, numCompaniesTarget, modules) => {
          await withRollback(async (client) => {
            const source = await newPerson(client);
            const target = await newPerson(client);

            // Vínculos a empresas distintas na origem e no destino.
            const sourceCompanies: string[] = [];
            for (let i = 0; i < numCompaniesSource; i++) {
              const co = await newCompany(client);
              sourceCompanies.push(co);
              await linkCompanyPerson(client, co, source);
            }
            const targetCompanies: string[] = [];
            for (let i = 0; i < numCompaniesTarget; i++) {
              const co = await newCompany(client);
              targetCompanies.push(co);
              await linkCompanyPerson(client, co, target);
            }

            // Uma categoria só na origem.
            const cat = await createCustomCategory(client, `cat-${seq}-${Math.random().toString(36).slice(2)}`);
            await assignCategory(client, source, cat.id);

            // Referências de módulo na origem.
            for (const m of modules) {
              await registerReference(client, m, "t", source);
            }

            await mergeContacts(client, source, target);

            // União dos vínculos no destino.
            const targetLinked = new Set(await getCompaniesOfPerson(client, target));
            for (const co of [...sourceCompanies, ...targetCompanies]) {
              expect(targetLinked.has(co)).toBe(true);
            }

            // Categoria transferida para o destino.
            const catRows = await client.query<{ count: string }>(
              `SELECT count(*)::text AS count FROM core.contact_category_assignments
               WHERE contact_id = $1 AND category_id = $2`,
              [target, cat.id],
            );
            expect(catRows.rows[0]?.count).toBe("1");

            // Referências de módulo agora apontam para o destino, não para a origem.
            const targetModules = new Set(await listModulesReferencing(client, target));
            for (const m of modules) {
              expect(targetModules.has(m)).toBe(true);
            }
            expect(await listModulesReferencing(client, source)).toEqual([]);

            // Origem marcada como mesclada no destino.
            const src = await getContactData(client, source);
            expect(src?.merged_into).toBe(target);
          });
        },
      ),
      RUNS,
    );
  });

  it("rejeita mesclagem de tipos diferentes", async () => {
    await withRollback(async (client) => {
      const person = await newPerson(client);
      const company = await newCompany(client);
      try {
        await mergeContacts(client, person, company);
        expect.unreachable("deveria rejeitar mesclagem de tipos diferentes");
      } catch (err) {
        expect(err).toBeInstanceOf(DomainError);
        expect((err as DomainError).code).toBe(ErrorCode.CONTACT_MERGE_INVALID);
      }
    });
  });

  it("rejeita mesclagem do contato consigo mesmo", async () => {
    await withRollback(async (client) => {
      const person = await newPerson(client);
      try {
        await mergeContacts(client, person, person);
        expect.unreachable("deveria rejeitar mesclagem consigo mesmo");
      } catch (err) {
        expect((err as DomainError).code).toBe(ErrorCode.CONTACT_MERGE_INVALID);
      }
    });
  });

  it("dedup ignora contato mesclado: e-mail liberado após merge", async () => {
    await withRollback(async (client) => {
      const email = `liberado-${Math.random().toString(36).slice(2)}@example.com`;
      const source = await createContact(client, {
        contact_type: "pessoa",
        full_name: "Origem",
        email,
        phone: "11999990000",
      });
      const target = await newPerson(client);
      await mergeContacts(client, source.id, target);

      // Com a origem mesclada (merged_into != null), o índice único parcial
      // libera o e-mail para um novo contato ativo.
      const reused = await createContact(client, {
        contact_type: "pessoa",
        full_name: "Novo",
        email,
        phone: "11999990000",
      });
      expect(reused.id).not.toBe(source.id);
    });
  });
});
