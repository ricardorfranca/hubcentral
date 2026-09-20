import { describe, it, expect, afterAll } from "vitest";
import { withRollback, closeTestPool } from "../helpers/db.js";
import { createContact, listContacts } from "../../src/core/contacts/contact-service.js";
import { createCustomCategory, assignCategory, unassignCategory } from "../../src/core/contacts/category-service.js";

/**
 * @file contacts-list.test.ts
 *
 * Testes da listagem de contatos com rótulos e filtros (Onda D — tela de
 * Contatos): busca por tipo/texto e agregação de labels.
 */

afterAll(async () => {
  await closeTestPool();
});

function rand(): string {
  return Math.random().toString(36).slice(2);
}

describe("Listagem de contatos", () => {
  it("filtra por tipo e por texto, e agrega rótulos", async () => {
    await withRollback(async (client) => {
      const email = `ana-${rand()}@x.com`;
      const person = await createContact(client, {
        contact_type: "pessoa", full_name: "Ana Souza", email, phone: "+5511999998888",
      });
      await createContact(client, {
        contact_type: "empresa", legal_name: "ACME LTDA", fiscal_document: String(30000000000000 + Math.floor(Math.random() * 8999999) + 1000000),
      });

      const cat = await createCustomCategory(client, `vip-${rand()}`);
      await assignCategory(client, person.id, cat.id);

      // Filtra pessoas com o texto "Ana".
      const pessoas = await listContacts(client, { type: "pessoa", search: "Ana" });
      const found = pessoas.find((c) => c.id === person.id);
      expect(found).toBeDefined();
      expect(found?.labels.some((l) => l.id === cat.id)).toBe(true);

      // Filtra empresas.
      const empresas = await listContacts(client, { type: "empresa" });
      expect(empresas.every((c) => c.contact_type === "empresa")).toBe(true);

      // Remover rótulo reflete na listagem.
      await unassignCategory(client, person.id, cat.id);
      const semLabel = (await listContacts(client, { type: "pessoa", search: "Ana" })).find((c) => c.id === person.id);
      expect(semLabel?.labels.some((l) => l.id === cat.id)).toBe(false);
    });
  });
});
