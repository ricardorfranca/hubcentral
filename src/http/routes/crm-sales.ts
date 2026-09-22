/**
 * @file crm-sales.ts
 * @module http/routes
 *
 * Rotas de vendas do CRM 2.0: contas e oportunidades (Receita Previsível).
 */

import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { withTransaction } from "../../core/db/pool.js";
import { createAccount, linkContact, listAccounts, getAccount } from "../../modules/crm/account-service.js";
import type { CompanyRegistrationFields } from "../../core/contacts/types.js";
import {
  createOpportunity, listOpportunities, getOpportunity, moveStage, finalize,
  type Origin, type Qualification,
} from "../../modules/crm/opportunity-service.js";
import { listStages, updateStage } from "../../modules/crm/stage-service.js";
import {
  weightedForecast, newMrrArr, conversionByStage, pipelineByOrigin, pipelineByOwner,
} from "../../modules/crm/forecast-service.js";

/**
 * Registra as rotas de contas e oportunidades.
 *
 * @param app - Instância Fastify.
 * @param pool - Pool de conexões.
 */
export function registerCrmSalesRoutes(app: FastifyInstance, pool: Pool): void {
  // --- Contas ---
  app.get("/api/crm/accounts", async (_request, reply) => {
    return reply.send(await withTransaction(pool, (c) => listAccounts(c)));
  });

  app.get<{ Params: { id: string } }>("/api/crm/accounts/:id", async (request, reply) => {
    const account = await withTransaction(pool, (c) => getAccount(c, request.params.id));
    if (!account) return reply.status(404).send({ code: "CRM_ACCOUNT_NOT_FOUND", message: "Conta não encontrada.", details: {} });
    return reply.send(account);
  });

  app.post<{
    Body: {
      legal_name: string;
      cnpj: string;
      segment?: string;
      size_tier?: string;
      /** Dados cadastrais oficiais da empresa (autofill por CNPJ). */
      company?: CompanyRegistrationFields;
    };
  }>(
    "/api/crm/accounts",
    async (request, reply) => {
      const b = request.body;
      const account = await withTransaction(pool, (c) =>
        createAccount(
          c,
          {
            legalName: b.legal_name,
            cnpj: b.cnpj,
            segment: b.segment,
            sizeTier: b.size_tier,
            ownerUserId: request.userId ?? undefined,
            company: b.company,
          },
          request.userId,
        ),
      );
      return reply.status(201).send(account);
    },
  );

  app.post<{ Params: { id: string }; Body: { person_contact_id: string; role?: string } }>(
    "/api/crm/accounts/:id/contacts",
    async (request, reply) => {
      await withTransaction(pool, (c) => linkContact(c, request.params.id, request.body.person_contact_id, request.body.role));
      return reply.status(204).send();
    },
  );

  // --- Oportunidades ---
  app.get<{ Querystring: { status?: string; stage_id?: string; account_id?: string; owner_user_id?: string } }>(
    "/api/crm/opportunities",
    async (request, reply) => {
      const q = request.query;
      const list = await withTransaction(pool, (c) =>
        listOpportunities(c, {
          status: q.status, stageId: q.stage_id, accountId: q.account_id, ownerUserId: q.owner_user_id,
        }),
      );
      return reply.send(list);
    },
  );

  app.get<{ Params: { id: string } }>("/api/crm/opportunities/:id", async (request, reply) => {
    const opp = await withTransaction(pool, (c) => getOpportunity(c, request.params.id));
    if (!opp) return reply.status(404).send({ code: "CRM_OPP_NOT_FOUND", message: "Oportunidade não encontrada.", details: {} });
    return reply.send(opp);
  });

  app.post<{
    Body: { account_id: string; name: string; primary_contact_id: string; mrr?: number; one_time?: number; origin?: Origin; qualification?: Qualification; stage_id?: string; expected_close?: string };
  }>("/api/crm/opportunities", async (request, reply) => {
    const b = request.body;
    const opp = await withTransaction(pool, (c) =>
      createOpportunity(c, {
        accountId: b.account_id, name: b.name, primaryContactId: b.primary_contact_id,
        mrr: b.mrr, oneTime: b.one_time,
        origin: b.origin, qualification: b.qualification, stageId: b.stage_id,
        expectedClose: b.expected_close,
        ownerUserId: request.userId ?? undefined,
      }, request.userId),
    );
    return reply.status(201).send(opp);
  });

  app.patch<{ Params: { id: string }; Body: { stage_id: string } }>(
    "/api/crm/opportunities/:id/stage",
    async (request, reply) => {
      const opp = await withTransaction(pool, (c) => moveStage(c, request.params.id, request.body.stage_id, request.userId));
      return reply.send(opp);
    },
  );

  app.patch<{ Params: { id: string }; Body: { outcome: "won" | "lost"; mrr?: number; one_time?: number; loss_reason?: string } }>(
    "/api/crm/opportunities/:id/finalize",
    async (request, reply) => {
      const b = request.body;
      const opp = await withTransaction(pool, (c) =>
        finalize(c, request.params.id, b.outcome, { mrr: b.mrr, oneTime: b.one_time, lossReason: b.loss_reason }, request.userId),
      );
      return reply.send(opp);
    },
  );

  // --- Estágios (pipeline configurável) ---
  app.get("/api/crm/stages", async (_request, reply) => {
    return reply.send(await withTransaction(pool, (c) => listStages(c)));
  });

  app.patch<{ Params: { id: string }; Body: { label?: string; probability?: number } }>(
    "/api/crm/stages/:id",
    async (request, reply) => {
      const patch: { label?: string; probability?: number } = {};
      if (request.body.label !== undefined) patch.label = request.body.label;
      if (request.body.probability !== undefined) patch.probability = request.body.probability;
      const stage = await withTransaction(pool, (c) => updateStage(c, request.params.id, patch));
      if (!stage) return reply.status(404).send({ code: "CRM_STAGE_NOT_FOUND", message: "Estágio não encontrado.", details: {} });
      return reply.send(stage);
    },
  );

  // --- Forecast / dashboards de Receita Previsível ---
  app.get("/api/crm/forecast", async (_request, reply) => {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    const to = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const data = await withTransaction(pool, async (c) => ({
      weighted: await weightedForecast(c),
      period: await newMrrArr(c, from, to),
      by_stage: await conversionByStage(c),
      by_origin: await pipelineByOrigin(c),
      by_owner: await pipelineByOwner(c),
    }));
    return reply.send(data);
  });
}
