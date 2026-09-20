import { describe, it, expect, afterAll } from "vitest";
import fc from "fast-check";
import type { PoolClient } from "pg";
import { withRollback, closeTestPool } from "../helpers/db.js";
import {
  createLead,
  getLeadView,
  resolveCampaignAudience,
} from "../../src/modules/crm/lead-service.js";
import { createContact } from "../../src/core/contacts/contact-service.js";
import { createCustomCategory, assignCategory } from "../../src/core/contacts/category-service.js";

/**
 * @file lead-service.test.ts
 *
 * Testes da migração do CRM para referência de contatos (Tarefa 15). Cobre P32
 * (find-or-create idempotente), a exibição via getContactData (Req 14.5) e a
 * segmentação de campanhas via Base Central (Req 14.4).
 */

const RUNS = { numRuns: 50 } as const;

afterAll(async () => {
  await closeTestPool();
});

const emailArb = fc
  .tuple(fc.stringMatching(/^[a-z0-9]{1,8}$/), fc.stringMatching(/^[a-z0-9]{1,6}$/))
  .map(([l, d]) => `${l}@${d}.com`);

describe("CRM — leads referenciando contatos centrais", () => {
  // Feature: central-contacts-and-module-contract, Property 32: Identidade
  // find-or-create do CRM é idempotente — dois leads com o mesmo e-mail de
  // pessoa apontam para o mesmo person_contact_id; nenhum contato duplicado.
  it("Property 32: find-or-create é idempotente por e-mail de pessoa", async () => {
    await fc.assert(
      fc.asyncProperty(emailArb, async (email) => {
        await withRollback(async (client) => {
          const lead1 = await createLead(client, {
            person: { full_name: "Pessoa A", email, phone: "11999990000" },
          });
          const lead2 = await createLead(client, {
            person: { full_name: "Pessoa A (2)", email, phone: "11999990000" },
          });

          // Mesmo contato para ambos os leads.
          expect(lead1.person_contact_id).toBe(lead2.person_contact_id);

          // Nenhum contato duplicado com esse e-mail.
          const { rows } = await client.query<{ count: string }>(
            `SELECT count(*)::text AS count FROM core.contacts
             WHERE contact_type = 'pessoa' AND email = $1 AND merged_into IS NULL`,
            [email],
          );
          expect(rows[0]?.count).toBe("1");
        });
      }),
      RUNS,
    );
  });

  it("Property 32: e-mail novo cria um único contato associado ao lead", async () => {
    await withRollback(async (client) => {
      const lead = await createLead(client, {
        person: { full_name: "Nova Pessoa", email: "nova@example.com", phone: "11999990000" },
      });
      const { rows } = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM core.contacts WHERE id = $1`,
        [lead.person_contact_id],
      );
      expect(rows[0]?.count).toBe("1");
    });
  });
});

describe("CRM — exibição e campanhas via Base Central", () => {
  it("Req 14.5: getLeadView lê os dados de contato da Base Central", async () => {
    await withRollback(async (client) => {
      const lead = await createLead(client, {
        person: { full_name: "João Silva", email: "joao@example.com", phone: "11988887777" },
        company: { legal_name: "Acme SA", fiscal_document: "12345678000199" },
      });

      const view = await getLeadView(client, lead.id);
      expect(view).not.toBeNull();
      expect(view?.person.full_name).toBe("João Silva");
      expect(view?.person.email?.toLowerCase()).toBe("joao@example.com");
      expect(view?.company?.legal_name).toBe("Acme SA");
      // A visão traz o contact_id da pessoa (referência), coerente com o lead.
      expect(view?.person.contact_id).toBe(lead.person_contact_id);
    });
  });

  it("Req 14.4: campanha resolve o público via segmentação da Base Central", async () => {
    await withRollback(async (client) => {
      // Cria uma categoria e dois contatos; associa a categoria a um deles.
      const cat = await createCustomCategory(client, `camp-${Math.random().toString(36).slice(2)}`);

      const alvo = await createContact(client, {
        contact_type: "pessoa",
        full_name: "Alvo",
        email: `alvo-${Math.random().toString(36).slice(2)}@example.com`,
        phone: "11999990000",
      });
      const foraDoAlvo = await createContact(client, {
        contact_type: "pessoa",
        full_name: "Fora",
        email: `fora-${Math.random().toString(36).slice(2)}@example.com`,
        phone: "11999990000",
      });
      await assignCategory(client, alvo.id, cat.id);

      const audience = await resolveCampaignAudience(client, { categories: [cat.id] });
      expect(audience).toContain(alvo.id);
      expect(audience).not.toContain(foraDoAlvo.id);
    });
  });
});
