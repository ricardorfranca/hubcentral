/**
 * @file opportunity-service.ts
 * @module modules/crm
 *
 * Serviço de Oportunidades do CRM 2.0. Oportunidades pertencem a uma Conta,
 * têm valor recorrente (MRR) e único, probabilidade herdada do estágio, e são
 * repetíveis por conta ao longo do tempo.
 */

import type { PoolClient } from "pg";
import { DomainError, ErrorCode } from "../../core/errors.js";
import { log as auditLog } from "../../core/audit/audit-logger.js";
import { publish, buildEnvelope } from "../../core/events/event-bus.js";

/** Origem da oportunidade (Predictable Revenue). */
export type Origin = "inbound" | "outbound" | "indicacao";
/** Qualificação. */
export type Qualification = "frio" | "morno" | "quente";

/** Oportunidade como persistida. */
export interface Opportunity {
  id: string;
  account_id: string;
  name: string;
  stage_id: string;
  probability: number;
  mrr: string;
  one_time: string;
  origin: Origin | null;
  qualification: Qualification | null;
  owner_user_id: string | null;
  status: "open" | "won" | "lost";
  loss_reason: string | null;
  expected_close: Date | null;
}

/** Colunas retornadas de uma oportunidade. */
const OPP_COLUMNS =
  "id, account_id, name, stage_id, probability, mrr, one_time, origin, qualification, owner_user_id, status, loss_reason, expected_close";

/** Lê a probabilidade de um estágio (e valida existência). */
async function stageProbability(client: PoolClient, stageId: string): Promise<number> {
  const { rows } = await client.query<{ probability: number }>(
    `SELECT probability FROM mod_crm.stages WHERE id = $1`,
    [stageId],
  );
  if (!rows[0]) {
    throw new DomainError(ErrorCode.CRM_STAGE_NOT_FOUND, "Estágio inexistente.", { stage_id: stageId });
  }
  return rows[0].probability;
}

/**
 * Cria uma oportunidade para uma conta. A probabilidade é herdada do estágio
 * inicial (default `novo`). Publica `crm.oportunidade.criada` e audita.
 *
 * @param client - Cliente PostgreSQL.
 * @param input - Dados da oportunidade.
 * @param actorUserId - Autor.
 * @returns A oportunidade criada.
 * @throws {DomainError} `CRM_ACCOUNT_NOT_FOUND` se a conta não existe.
 */
export async function createOpportunity(
  client: PoolClient,
  input: {
    accountId: string;
    name: string;
    mrr?: number | undefined;
    oneTime?: number | undefined;
    origin?: Origin | undefined;
    qualification?: Qualification | undefined;
    ownerUserId?: string | undefined;
    stageId?: string | undefined;
    expectedClose?: string | undefined;
  },
  actorUserId: string | null = null,
): Promise<Opportunity> {
  const account = await client.query<{ id: string }>(
    `SELECT id FROM mod_crm.accounts WHERE id = $1`,
    [input.accountId],
  );
  if (!account.rows[0]) {
    throw new DomainError(ErrorCode.CRM_ACCOUNT_NOT_FOUND, "Conta não encontrada.", {
      account_id: input.accountId,
    });
  }

  const stageId = input.stageId ?? "novo";
  const probability = await stageProbability(client, stageId);

  const { rows } = await client.query<Opportunity>(
    `INSERT INTO mod_crm.opportunities
       (account_id, name, stage_id, probability, mrr, one_time, origin, qualification, owner_user_id, expected_close, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING ${OPP_COLUMNS}`,
    [
      input.accountId, input.name, stageId, probability,
      input.mrr ?? 0, input.oneTime ?? 0,
      input.origin ?? null, input.qualification ?? null,
      input.ownerUserId ?? null, input.expectedClose ?? null, actorUserId,
    ],
  );
  const opp = rows[0] as Opportunity;

  await auditLog(client, {
    userId: actorUserId,
    module: "crm",
    action: "CRM_OPORTUNIDADE_CRIADA",
    payloadAfter: { opportunity_id: opp.id, account_id: input.accountId, mrr: opp.mrr, one_time: opp.one_time },
  });
  await publish(
    client,
    buildEnvelope("crm.oportunidade.criada", "mod_crm", {
      opportunity_id: opp.id,
      account_id: input.accountId,
    }),
  );

  return opp;
}

/** Oportunidade para listagem, com nome da conta e ARR derivado. */
export interface OpportunityListItem extends Opportunity {
  account_name: string | null;
  arr: number;
}

/**
 * Lista oportunidades com o nome da conta resolvido e ARR (mrr×12) derivado.
 * Suporta filtros opcionais.
 *
 * @param client - Cliente PostgreSQL.
 * @param filters - Filtros opcionais (status, dono, estágio, conta).
 * @returns Lista de oportunidades.
 */
export async function listOpportunities(
  client: PoolClient,
  filters: {
    status?: string | undefined;
    ownerUserId?: string | undefined;
    stageId?: string | undefined;
    accountId?: string | undefined;
  } = {},
): Promise<OpportunityListItem[]> {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filters.status) { params.push(filters.status); clauses.push(`o.status = $${params.length}`); }
  if (filters.ownerUserId) { params.push(filters.ownerUserId); clauses.push(`o.owner_user_id = $${params.length}`); }
  if (filters.stageId) { params.push(filters.stageId); clauses.push(`o.stage_id = $${params.length}`); }
  if (filters.accountId) { params.push(filters.accountId); clauses.push(`o.account_id = $${params.length}`); }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";

  const { rows } = await client.query<Opportunity & { account_name: string | null }>(
    `SELECT o.id, o.account_id, o.name, o.stage_id, o.probability, o.mrr, o.one_time,
            o.origin, o.qualification, o.owner_user_id, o.status, o.loss_reason, o.expected_close,
            c.legal_name AS account_name
     FROM mod_crm.opportunities o
     JOIN mod_crm.accounts a ON a.id = o.account_id
     JOIN core.contacts c ON c.id = a.company_contact_id
     ${where}
     ORDER BY o.updated_at DESC`,
    params,
  );
  return rows.map((r) => ({ ...r, arr: Number(r.mrr) * 12 }));
}

/**
 * Retorna uma oportunidade por id.
 *
 * @param client - Cliente PostgreSQL.
 * @param id - `id` da oportunidade.
 * @returns A oportunidade, ou `null`.
 */
export async function getOpportunity(client: PoolClient, id: string): Promise<Opportunity | null> {
  const { rows } = await client.query<Opportunity>(
    `SELECT ${OPP_COLUMNS} FROM mod_crm.opportunities WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

/**
 * Move a oportunidade para outro estágio; a probabilidade passa a ser a do
 * estágio. Publica `crm.oportunidade.movida` e audita.
 *
 * @param client - Cliente PostgreSQL.
 * @param id - `id` da oportunidade.
 * @param stageId - Estágio de destino.
 * @param actorUserId - Autor.
 * @returns A oportunidade atualizada.
 * @throws {DomainError} `CRM_OPP_NOT_FOUND` / `CRM_STAGE_NOT_FOUND`.
 */
export async function moveStage(
  client: PoolClient,
  id: string,
  stageId: string,
  actorUserId: string | null = null,
): Promise<Opportunity> {
  const before = await getOpportunity(client, id);
  if (!before) {
    throw new DomainError(ErrorCode.CRM_OPP_NOT_FOUND, "Oportunidade não encontrada.", { opportunity_id: id });
  }
  const probability = await stageProbability(client, stageId);
  const { rows } = await client.query<Opportunity>(
    `UPDATE mod_crm.opportunities SET stage_id = $2, probability = $3, updated_at = now()
     WHERE id = $1 RETURNING ${OPP_COLUMNS}`,
    [id, stageId, probability],
  );
  const opp = rows[0] as Opportunity;

  await auditLog(client, {
    userId: actorUserId,
    module: "crm",
    action: "CRM_OPORTUNIDADE_MOVIDA",
    payloadBefore: { stage_id: before.stage_id },
    payloadAfter: { stage_id: stageId },
  });
  await publish(
    client,
    buildEnvelope("crm.oportunidade.movida", "mod_crm", {
      opportunity_id: id, from_stage: before.stage_id, to_stage: stageId,
    }),
  );
  return opp;
}

/**
 * Finaliza a oportunidade como ganha ou perdida. Ganho exige MRR ou valor único;
 * perda exige motivo. Move para o estágio terminal correspondente. Publica
 * `crm.oportunidade.ganha|perdida` e audita.
 *
 * @param client - Cliente PostgreSQL.
 * @param id - `id` da oportunidade.
 * @param outcome - `won` ou `lost`.
 * @param details - Valores (ganho) ou motivo (perda).
 * @param actorUserId - Autor.
 * @returns A oportunidade finalizada.
 * @throws {DomainError} `CRM_OPP_NOT_FOUND` / `CRM_OPP_FINALIZE_INVALID`.
 */
export async function finalize(
  client: PoolClient,
  id: string,
  outcome: "won" | "lost",
  details: { mrr?: number | undefined; oneTime?: number | undefined; lossReason?: string | undefined },
  actorUserId: string | null = null,
): Promise<Opportunity> {
  const before = await getOpportunity(client, id);
  if (!before) {
    throw new DomainError(ErrorCode.CRM_OPP_NOT_FOUND, "Oportunidade não encontrada.", { opportunity_id: id });
  }

  if (outcome === "won") {
    const mrr = details.mrr ?? Number(before.mrr);
    const oneTime = details.oneTime ?? Number(before.one_time);
    if (mrr <= 0 && oneTime <= 0) {
      throw new DomainError(ErrorCode.CRM_OPP_FINALIZE_INVALID, "Ganho exige MRR ou valor único.", {});
    }
    const { rows } = await client.query<Opportunity>(
      `UPDATE mod_crm.opportunities
       SET status = 'won', stage_id = 'ganho', probability = 100, mrr = $2, one_time = $3, updated_at = now()
       WHERE id = $1 RETURNING ${OPP_COLUMNS}`,
      [id, mrr, oneTime],
    );
    await auditLog(client, { userId: actorUserId, module: "crm", action: "CRM_OPORTUNIDADE_GANHA", payloadAfter: { opportunity_id: id, mrr, one_time: oneTime } });
    await publish(client, buildEnvelope("crm.oportunidade.ganha", "mod_crm", { opportunity_id: id, account_id: before.account_id, mrr, one_time: oneTime }));
    return rows[0] as Opportunity;
  }

  if (!details.lossReason) {
    throw new DomainError(ErrorCode.CRM_OPP_FINALIZE_INVALID, "Perda exige um motivo.", {});
  }
  const { rows } = await client.query<Opportunity>(
    `UPDATE mod_crm.opportunities
     SET status = 'lost', stage_id = 'perdido', probability = 0, loss_reason = $2, updated_at = now()
     WHERE id = $1 RETURNING ${OPP_COLUMNS}`,
    [id, details.lossReason],
  );
  await auditLog(client, { userId: actorUserId, module: "crm", action: "CRM_OPORTUNIDADE_PERDIDA", payloadAfter: { opportunity_id: id, loss_reason: details.lossReason } });
  await publish(client, buildEnvelope("crm.oportunidade.perdida", "mod_crm", { opportunity_id: id, account_id: before.account_id, loss_reason: details.lossReason }));
  return rows[0] as Opportunity;
}
