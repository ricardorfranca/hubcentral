import { describe, it, expect, afterAll } from "vitest";
import fc from "fast-check";
import type { PoolClient } from "pg";
import { withRollback, closeTestPool } from "../helpers/db.js";
import { slaToMs, urgencyLevel, computeSlaOnMove } from "../../src/modules/crm/sla-service.js";
import { dmConversationId, sendMessage, listMessages, GROUP_CONVERSATION } from "../../src/modules/crm/message-service.js";
import { renderTemplate } from "../../src/modules/crm/campaign-service.js";
import { addListItem, listItems, deactivateListItem } from "../../src/modules/crm/list-service.js";
import { createContact } from "../../src/core/contacts/contact-service.js";
import { createLead, moveLead } from "../../src/modules/crm/lead-service.js";
import { getTimeline } from "../../src/modules/crm/timeline-service.js";

/**
 * @file crm-extra.test.ts
 *
 * Testes dos recursos adicionais do CRM: SLA (memória + urgência), listas,
 * mensageria, campanhas (template) e timeline.
 */

const RUNS = { numRuns: 100 } as const;

afterAll(async () => {
  await closeTestPool();
});

let seq = 0;
async function newLead(client: PoolClient): Promise<string> {
  seq += 1;
  const lead = await createLead(client, {
    person: { full_name: `Lead ${seq}`, email: `crmx${seq}-${Math.random().toString(36).slice(2)}@example.com`, phone: "11999990000" },
  });
  return lead.id;
}

describe("SLA — urgência e conversões (funções puras)", () => {
  it("urgencyLevel: ok >50%, warning 25-50%, critical <25% ou vencido", () => {
    const total = 1000;
    expect(urgencyLevel(600, total)).toBe("ok");
    expect(urgencyLevel(500, total)).toBe("ok"); // fronteira 50% inclusiva em ok
    expect(urgencyLevel(499, total)).toBe("warning");
    expect(urgencyLevel(300, total)).toBe("warning");
    expect(urgencyLevel(250, total)).toBe("warning"); // fronteira 25% inclusiva em warning
    expect(urgencyLevel(200, total)).toBe("critical");
    expect(urgencyLevel(-10, total)).toBe("critical");
  });

  it("slaToMs converte corretamente por unidade", () => {
    expect(slaToMs(30, "minutes")).toBe(30 * 60_000);
    expect(slaToMs(2, "hours")).toBe(2 * 3_600_000);
    expect(slaToMs(7, "days")).toBe(7 * 86_400_000);
  });

  // Property: memória de SLA — ao retornar a uma etapa, o deadline salvo é
  // restaurado (não reinicia). Ao entrar numa etapa nova com SLA, usa now+total.
  it("Property: memória de SLA restaura o deadline ao retornar à etapa", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 120 }), (minutes) => {
        const now = new Date("2026-01-01T00:00:00Z");
        const sla = { column_id: "ligacao", value: minutes, unit: "minutes" as const };

        // Entra em 'ligacao' (sem memória): deadline = now + total.
        const first = computeSlaOnMove({
          fromColumn: "novo",
          toColumn: "ligacao",
          currentDeadline: null,
          history: {},
          toColumnSla: sla,
          now,
        });
        const expected = new Date(now.getTime() + minutes * 60_000).toISOString();
        expect(first.deadline).toBe(expected);

        // Sai para 'proposta' (memoriza o deadline de 'ligacao').
        const second = computeSlaOnMove({
          fromColumn: "ligacao",
          toColumn: "proposta",
          currentDeadline: first.deadline,
          history: first.history,
          toColumnSla: { column_id: "proposta", value: 30, unit: "minutes" },
          now: new Date(now.getTime() + 5 * 60_000),
        });
        expect(second.history["ligacao"]).toBe(first.deadline);

        // Volta para 'ligacao': restaura o deadline salvo (não reinicia).
        const third = computeSlaOnMove({
          fromColumn: "proposta",
          toColumn: "ligacao",
          currentDeadline: second.deadline,
          history: second.history,
          toColumnSla: sla,
          now: new Date(now.getTime() + 10 * 60_000),
        });
        expect(third.deadline).toBe(first.deadline);
      }),
      RUNS,
    );
  });

  it("etapa sem SLA zera o deadline", () => {
    const now = new Date();
    const r = computeSlaOnMove({
      fromColumn: "ligacao",
      toColumn: "acompanhamento",
      currentDeadline: new Date().toISOString(),
      history: {},
      toColumnSla: null,
      now,
    });
    expect(r.deadline).toBeNull();
  });
});

describe("Mensageria e campanhas (puras)", () => {
  it("Property: dmConversationId é determinístico e independe da ordem", () => {
    fc.assert(
      fc.property(fc.uuid(), fc.uuid(), (a, b) => {
        fc.pre(a !== b);
        expect(dmConversationId(a, b)).toBe(dmConversationId(b, a));
        expect(dmConversationId(a, b)).toMatch(/^dm_/);
      }),
      RUNS,
    );
  });

  it("renderTemplate substitui variáveis conhecidas e ignora desconhecidas", () => {
    const body = "Olá {{nome_lead}} da {{empresa_lead}}. Produto: {{produto}}. {{inexistente}}";
    const out = renderTemplate(body, { nome_lead: "Ana", empresa_lead: "Acme", produto: "Fibra" });
    expect(out).toBe("Olá Ana da Acme. Produto: Fibra. ");
  });
});

describe("Listas, timeline e mensageria (com banco)", () => {
  it("listas: adiciona, lista ativos e desativa", async () => {
    await withRollback(async (client) => {
      const item = await addListItem(client, "tag", `Premium-${Math.random().toString(36).slice(2)}`);
      let items = await listItems(client, "tag");
      expect(items.some((i) => i.id === item.id)).toBe(true);

      await deactivateListItem(client, item.id);
      items = await listItems(client, "tag");
      expect(items.some((i) => i.id === item.id)).toBe(false);
    });
  });

  it("mover lead registra entrada 'stage' na timeline e aplica SLA da etapa", async () => {
    await withRollback(async (client) => {
      const leadId = await newLead(client);
      await moveLead(client, leadId, "ligacao");

      const timeline = await getTimeline(client, leadId);
      expect(timeline.some((t) => t.action_type === "stage")).toBe(true);

      // 'ligacao' tem SLA seed de 30 min → deadline setado.
      const { rows } = await client.query<{ sla_deadline: Date | null }>(
        `SELECT sla_deadline FROM mod_crm.leads WHERE id = $1`,
        [leadId],
      );
      expect(rows[0]?.sla_deadline).not.toBeNull();
    });
  });

  it("mensageria: envia no canal group e lista", async () => {
    await withRollback(async (client) => {
      const conv = GROUP_CONVERSATION;
      const before = (await listMessages(client, conv)).length;
      await sendMessage(client, { fromUserId: null, conversationId: conv, text: "Olá equipe", type: "system" });
      const after = await listMessages(client, conv);
      expect(after.length).toBe(before + 1);
      expect(after[after.length - 1]?.from_user_name).toBe("Sistema");
    });
  });
});
