import { describe, it, expect, afterAll } from "vitest";
import { withRollback, closeTestPool } from "../helpers/db.js";
import { createLead, moveLead, finalizeLead } from "../../src/modules/crm/lead-service.js";
import { isValidEventName } from "../../src/core/events/event-bus.js";

/**
 * @file lead-events.test.ts
 *
 * Testes da fiação de eventos crm.lead.* (Tarefa 16). Reusa P27 (formato do
 * nome) e P28 (payload carrega apenas referências de contato, nunca dados) em
 * todos os eventos do ciclo de vida do lead.
 */

afterAll(async () => {
  await closeTestPool();
});

/** Campos de dado de contato que NUNCA podem aparecer nos payloads (Req 12.3). */
const FORBIDDEN = ["name", "full_name", "email", "phone", "company", "legal_name", "fiscal_document"];

/** Lê os eventos publicados no outbox para um lead. */
async function eventsFor(client: import("pg").PoolClient, leadId: string) {
  const { rows } = await client.query<{ event_name: string; envelope: { payload: Record<string, unknown> } }>(
    `SELECT event_name, envelope FROM core.event_outbox
     WHERE envelope->'payload'->>'lead_id' = $1 ORDER BY created_at`,
    [leadId],
  );
  return rows;
}

describe("Eventos crm.lead.* carregam apenas referências de contato", () => {
  it("crm.lead.criado / movido / ganho publicam com formato válido e sem dados de contato", async () => {
    await withRollback(async (client) => {
      const lead = await createLead(client, {
        person: { full_name: "Maria", email: "maria@example.com", phone: "11999990000" },
        company: { legal_name: "Beta Ltda", fiscal_document: "99999999000191" },
      });
      await moveLead(client, lead.id, "proposta");
      await finalizeLead(client, lead.id, "won", { valueActivation: 1000, valueMonthly: 200 });

      const events = await eventsFor(client, lead.id);
      const names = events.map((e) => e.event_name);
      expect(names).toContain("crm.lead.criado");
      expect(names).toContain("crm.lead.movido");
      expect(names).toContain("crm.lead.ganho");

      for (const ev of events) {
        // P27: formato [modulo].[recurso].[acao].
        expect(isValidEventName(ev.event_name)).toBe(true);
        // P28: payload carrega person_contact_id (referência), sem dados de contato.
        expect(ev.envelope.payload).toHaveProperty("person_contact_id");
        for (const forbidden of FORBIDDEN) {
          expect(ev.envelope.payload).not.toHaveProperty(forbidden);
        }
      }
    });
  });

  it("crm.lead.perdido publica com motivo e sem dados de contato", async () => {
    await withRollback(async (client) => {
      const lead = await createLead(client, {
        person: { full_name: "Carlos", email: "carlos@example.com", phone: "11999990000" },
      });
      await finalizeLead(client, lead.id, "lost", { lossReason: "Preço" });

      const events = await eventsFor(client, lead.id);
      const perdido = events.find((e) => e.event_name === "crm.lead.perdido");
      expect(perdido).toBeDefined();
      expect(perdido?.envelope.payload.loss_reason).toBe("Preço");
      expect(perdido?.envelope.payload).toHaveProperty("person_contact_id");
      for (const forbidden of FORBIDDEN) {
        expect(perdido?.envelope.payload).not.toHaveProperty(forbidden);
      }
    });
  });
});
