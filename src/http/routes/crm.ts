/**
 * @file crm.ts
 * @module http/routes
 *
 * Rotas HTTP do módulo CRM. Os handlers delegam ao lead-service, que referencia
 * contatos centrais por contact_id (nenhum dado de contato trafega em mod_crm).
 */

import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { withTransaction } from "../../core/db/pool.js";
import {
  createLead,
  moveLead,
  finalizeLead,
  getLeadView,
  listLeads,
  type CreateLeadInput,
} from "../../modules/crm/lead-service.js";

/**
 * Registra as rotas do CRM na instância Fastify.
 *
 * @param app - Instância Fastify.
 * @param pool - Pool de conexões.
 */
export function registerCrmRoutes(app: FastifyInstance, pool: Pool): void {
  // Listar leads (pipeline), com nome do contato resolvido.
  app.get("/api/crm/leads", async (_request, reply) => {
    const leads = await withTransaction(pool, (client) => listLeads(client));
    return reply.send(leads);
  });

  // Criar lead (find-or-create de contatos + publica crm.lead.criado).
  app.post<{ Body: CreateLeadInput }>("/api/crm/leads", async (request, reply) => {
    const lead = await withTransaction(pool, (client) =>
      createLead(client, request.body, request.userId),
    );
    return reply.status(201).send(lead);
  });

  // Obter a visão do lead com dados de contato resolvidos da Base Central.
  app.get<{ Params: { id: string } }>("/api/crm/leads/:id", async (request, reply) => {
    const view = await withTransaction(pool, (client) => getLeadView(client, request.params.id));
    if (!view) {
      return reply.status(404).send({ code: "LEAD_NOT_FOUND", message: "Lead não encontrado.", details: {} });
    }
    return reply.send(view);
  });

  // Mover lead entre etapas (publica crm.lead.movido).
  app.patch<{ Params: { id: string }; Body: { to_column: string } }>(
    "/api/crm/leads/:id/move",
    async (request, reply) => {
      const lead = await withTransaction(pool, (client) =>
        moveLead(client, request.params.id, request.body.to_column, request.userId),
      );
      return reply.send(lead);
    },
  );

  // Finalizar lead como ganho ou perdido (publica crm.lead.ganho|perdido).
  app.patch<{
    Params: { id: string };
    Body: { outcome: "won" | "lost"; value_activation?: number; value_monthly?: number; loss_reason?: string };
  }>("/api/crm/leads/:id/finalize", async (request, reply) => {
    const { outcome, value_activation, value_monthly, loss_reason } = request.body;
    const details: { valueActivation?: number; valueMonthly?: number; lossReason?: string } = {};
    if (value_activation !== undefined) details.valueActivation = value_activation;
    if (value_monthly !== undefined) details.valueMonthly = value_monthly;
    if (loss_reason !== undefined) details.lossReason = loss_reason;
    const lead = await withTransaction(pool, (client) =>
      finalizeLead(client, request.params.id, outcome, details, request.userId),
    );
    return reply.send(lead);
  });
}
