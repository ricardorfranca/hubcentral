/**
 * @file crm-extra.ts
 * @module http/routes
 *
 * Rotas HTTP dos recursos adicionais do CRM: listas configuráveis, SLA,
 * timeline, mensageria, campanhas e relatórios.
 */

import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { withTransaction } from "../../core/db/pool.js";
import { addListItem, listItems, type ListType } from "../../modules/crm/list-service.js";
import { setSlaConfig, getSlaConfig, type SlaUnit } from "../../modules/crm/sla-service.js";
import { getTimeline } from "../../modules/crm/timeline-service.js";
import { sendMessage, listMessages } from "../../modules/crm/message-service.js";
import { createCampaign, dispatchCampaign, resolveAudience, listCampaigns, type CampaignChannel } from "../../modules/crm/campaign-service.js";
import { closingsReport, lossReasonsReport, performanceReport, slaReport } from "../../modules/crm/report-service.js";

/**
 * Registra as rotas adicionais do CRM.
 *
 * @param app - Instância Fastify.
 * @param pool - Pool de conexões.
 */
export function registerCrmExtraRoutes(app: FastifyInstance, pool: Pool): void {
  // Listas configuráveis.
  app.get<{ Params: { type: ListType } }>("/api/crm/lists/:type", async (request, reply) => {
    const items = await withTransaction(pool, (c) => listItems(c, request.params.type));
    return reply.send(items);
  });
  app.post<{ Params: { type: ListType }; Body: { value: string } }>(
    "/api/crm/lists/:type",
    async (request, reply) => {
      const item = await withTransaction(pool, (c) => addListItem(c, request.params.type, request.body.value));
      return reply.status(201).send(item);
    },
  );

  // SLA por etapa.
  app.get<{ Params: { columnId: string } }>("/api/crm/sla/:columnId", async (request, reply) => {
    const cfg = await withTransaction(pool, (c) => getSlaConfig(c, request.params.columnId));
    if (!cfg) return reply.status(404).send({ code: "SLA_NOT_FOUND", message: "Sem SLA para a etapa.", details: {} });
    return reply.send(cfg);
  });
  app.put<{ Params: { columnId: string }; Body: { value: number; unit: SlaUnit } }>(
    "/api/crm/sla/:columnId",
    async (request, reply) => {
      await withTransaction(pool, (c) =>
        setSlaConfig(c, request.params.columnId, request.body.value, request.body.unit, request.userId),
      );
      return reply.status(204).send();
    },
  );

  // Timeline de um lead.
  app.get<{ Params: { id: string } }>("/api/crm/leads/:id/timeline", async (request, reply) => {
    const entries = await withTransaction(pool, (c) => getTimeline(c, request.params.id));
    return reply.send(entries);
  });
}

/**
 * Registra as rotas de mensageria, campanhas e relatórios do CRM.
 *
 * @param app - Instância Fastify.
 * @param pool - Pool de conexões.
 */
export function registerCrmMessagingRoutes(app: FastifyInstance, pool: Pool): void {
  // Mensageria: listar e enviar.
  app.get<{ Params: { conversationId: string } }>(
    "/api/crm/messages/:conversationId",
    async (request, reply) => {
      const msgs = await withTransaction(pool, (c) => listMessages(c, request.params.conversationId));
      return reply.send(msgs);
    },
  );
  app.post<{ Body: { conversation_id: string; text: string; lead_id?: string } }>(
    "/api/crm/messages",
    async (request, reply) => {
      const msg = await withTransaction(pool, (c) =>
        sendMessage(c, {
          fromUserId: request.userId,
          conversationId: request.body.conversation_id,
          text: request.body.text,
          leadId: request.body.lead_id ?? null,
        }),
      );
      return reply.status(201).send(msg);
    },
  );

  // Campanhas: listar.
  app.get("/api/crm/campaigns", async (_request, reply) => {
    const campaigns = await withTransaction(pool, (c) => listCampaigns(c));
    return reply.send(campaigns);
  });

  // Campanhas: criar e disparar.
  app.post<{
    Body: { name: string; tags: string[]; channels: CampaignChannel[]; subject?: string; body_text?: string; body_html?: string };
  }>("/api/crm/campaigns", async (request, reply) => {
    const b = request.body;
    const input: Parameters<typeof createCampaign>[1] = { name: b.name, tags: b.tags, channels: b.channels };
    if (b.subject !== undefined) input.subject = b.subject;
    if (b.body_text !== undefined) input.bodyText = b.body_text;
    if (b.body_html !== undefined) input.bodyHtml = b.body_html;
    const campaign = await withTransaction(pool, (c) => createCampaign(c, input, request.userId));
    return reply.status(201).send(campaign);
  });
  app.post<{ Params: { id: string }; Body: { channel: CampaignChannel; category_ids: string[] } }>(
    "/api/crm/campaigns/:id/dispatch",
    async (request, reply) => {
      const count = await withTransaction(pool, async (c) => {
        const audience = await resolveAudience(c, request.body.category_ids);
        return dispatchCampaign(c, request.params.id, request.body.channel, audience, request.userId);
      });
      return reply.send({ lead_count: count });
    },
  );

  // Relatórios.
  app.get("/api/crm/reports/closings", async (_request, reply) => {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    const to = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const report = await withTransaction(pool, (c) => closingsReport(c, from, to));
    return reply.send(report);
  });
  app.get("/api/crm/reports/loss-reasons", async (_request, reply) => {
    return reply.send(await withTransaction(pool, (c) => lossReasonsReport(c)));
  });
  app.get("/api/crm/reports/performance", async (_request, reply) => {
    return reply.send(await withTransaction(pool, (c) => performanceReport(c)));
  });
  app.get("/api/crm/reports/sla", async (_request, reply) => {
    return reply.send(await withTransaction(pool, (c) => slaReport(c)));
  });
}
