/**
 * @file lead-service.ts
 * @module modules/crm
 *
 * Serviço de leads do CRM (Req 14). Os leads referenciam contatos centrais por
 * contact_id; nenhum dado de contato é copiado para o schema mod_crm. A criação
 * usa find-or-create na Base Central e registra a referência; a exibição lê os
 * dados de contato via ContactService.
 */

import type { PoolClient } from "pg";
import {
  findOrCreatePerson,
  findOrCreateCompany,
  getContactData,
} from "../../core/contacts/contact-service.js";
import { registerReference } from "../../core/contacts/reference-service.js";
import { evaluateSegment, type SegmentCriteria } from "../../core/contacts/segment-service.js";
import { log as auditLog } from "../../core/audit/audit-logger.js";
import { publish, buildEnvelope } from "../../core/events/event-bus.js";
import { getSlaConfig, computeSlaOnMove } from "./sla-service.js";
import { addTimelineEntry } from "./timeline-service.js";

/** Dados de entrada para criar um lead (contato + negócio). */
export interface CreateLeadInput {
  /** Dados da pessoa (find-or-create na Base Central). */
  person: { full_name: string; email: string; phone: string };
  /** Dados da empresa (opcional; find-or-create). */
  company?: { legal_name: string; fiscal_document: string };
  /** Vendedor responsável (user_id). */
  assignedTo?: string;
  /** Etapa inicial do pipeline. */
  columnId?: string;
}

/** Lead como persistido em mod_crm.leads. */
export interface Lead {
  id: string;
  person_contact_id: string;
  company_contact_id: string | null;
  assigned_to: string | null;
  column_id: string;
  status: string;
}

/** Lead para a listagem do Kanban, com nome do contato resolvido. */
export interface LeadListItem extends Lead {
  person_name: string | null;
  company_name: string | null;
}

/**
 * Lista os leads ativos (não descartados/finalizados sob demanda) com o nome do
 * contato resolvido da Base Central, para exibição no pipeline. Ordena por
 * criação mais recente.
 *
 * @param client - Cliente PostgreSQL.
 * @returns Lista de leads com nomes de contato.
 */
export async function listLeads(client: PoolClient): Promise<LeadListItem[]> {
  const { rows } = await client.query<LeadListItem>(
    `SELECT l.id, l.person_contact_id, l.company_contact_id, l.assigned_to, l.column_id, l.status,
            p.full_name AS person_name, e.legal_name AS company_name
     FROM mod_crm.leads l
     LEFT JOIN core.contacts p ON p.id = l.person_contact_id
     LEFT JOIN core.contacts e ON e.id = l.company_contact_id
     ORDER BY l.created_at DESC`,
  );
  return rows;
}

/**
 * Cria um lead referenciando contatos centrais (Req 14.1–14.3). Faz
 * find-or-create da pessoa (por e-mail) e da empresa (por documento fiscal),
 * registra as referências e publica `crm.lead.criado` com apenas as referências.
 *
 * @param client - Cliente PostgreSQL (em transação).
 * @param input - Dados do lead.
 * @param actorUserId - Autor, ou `null` para SYSTEM.
 * @returns O lead criado.
 */
export async function createLead(
  client: PoolClient,
  input: CreateLeadInput,
  actorUserId: string | null = null,
): Promise<Lead> {
  const personId = await findOrCreatePerson(client, input.person, actorUserId);
  await registerReference(client, "mod_crm", "leads", personId);

  let companyId: string | null = null;
  if (input.company) {
    companyId = await findOrCreateCompany(client, input.company, actorUserId);
    await registerReference(client, "mod_crm", "leads", companyId);
  }

  const { rows } = await client.query<Lead>(
    `INSERT INTO mod_crm.leads (person_contact_id, company_contact_id, assigned_to, column_id, created_by)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, person_contact_id, company_contact_id, assigned_to, column_id, status`,
    [personId, companyId, input.assignedTo ?? null, input.columnId ?? "novo", actorUserId],
  );
  const lead = rows[0] as Lead;

  await auditLog(client, {
    userId: actorUserId,
    module: "crm",
    action: "CRM_LEAD_CRIADO",
    payloadAfter: { lead_id: lead.id, person_contact_id: personId, company_contact_id: companyId },
  });

  // Evento carrega apenas referências de contato (Req 12.3).
  await publish(
    client,
    buildEnvelope("crm.lead.criado", "mod_crm", {
      lead_id: lead.id,
      person_contact_id: personId,
      company_contact_id: companyId,
    }),
  );

  return lead;
}

/** Visão de um lead com os dados de contato resolvidos da Base Central. */
export interface LeadView {
  id: string;
  column_id: string;
  status: string;
  person: { contact_id: string; full_name: string | null; email: string | null; phone: string | null };
  company: { contact_id: string; legal_name: string | null; fiscal_document: string | null } | null;
}

/**
 * Retorna a visão de um lead com os dados de contato obtidos da Base Central
 * via ContactService (Req 14.5). Nenhum dado de contato vem de mod_crm.
 *
 * @param client - Cliente PostgreSQL.
 * @param leadId - `id` do lead.
 * @returns A visão do lead, ou `null` se o lead não existe.
 */
export async function getLeadView(client: PoolClient, leadId: string): Promise<LeadView | null> {
  const { rows } = await client.query<Lead>(
    `SELECT id, person_contact_id, company_contact_id, assigned_to, column_id, status
     FROM mod_crm.leads WHERE id = $1`,
    [leadId],
  );
  const lead = rows[0];
  if (!lead) {
    return null;
  }

  const person = await getContactData(client, lead.person_contact_id);
  const company = lead.company_contact_id
    ? await getContactData(client, lead.company_contact_id)
    : null;

  return {
    id: lead.id,
    column_id: lead.column_id,
    status: lead.status,
    person: {
      contact_id: lead.person_contact_id,
      full_name: person?.full_name ?? null,
      email: person?.email ?? null,
      phone: person?.phone ?? null,
    },
    company: company
      ? {
          contact_id: company.id,
          legal_name: company.legal_name,
          fiscal_document: company.fiscal_document,
        }
      : null,
  };
}

/**
 * Resolve o público-alvo de uma campanha via segmentação da Base Central
 * (Req 14.4). Retorna apenas os `contact_id` das pessoas segmentadas.
 *
 * @param client - Cliente PostgreSQL.
 * @param criteria - Critérios de segmentação.
 * @returns Lista de `contact_id` do público-alvo.
 */
export async function resolveCampaignAudience(
  client: PoolClient,
  criteria: SegmentCriteria,
): Promise<string[]> {
  return evaluateSegment(client, criteria);
}

/**
 * Move um lead entre etapas do pipeline (Req 12.2, 12.3). Publica
 * `crm.lead.movido` carregando as referências de contato (nunca dados de
 * contato) e a transição de etapas.
 *
 * @param client - Cliente PostgreSQL (em transação).
 * @param leadId - `id` do lead.
 * @param toColumn - Etapa de destino.
 * @param actorUserId - Autor, ou `null` para SYSTEM.
 * @returns O lead atualizado.
 * @throws {Error} Se o lead não existe.
 */
export async function moveLead(
  client: PoolClient,
  leadId: string,
  toColumn: string,
  actorUserId: string | null = null,
): Promise<Lead> {
  const current = await client.query<
    Lead & { sla_deadline: string | null; sla_history: Record<string, string> }
  >(
    `SELECT id, person_contact_id, company_contact_id, assigned_to, column_id, status,
            sla_deadline, sla_history
     FROM mod_crm.leads WHERE id = $1`,
    [leadId],
  );
  const before = current.rows[0];
  if (!before) {
    throw new Error(`Lead não encontrado: ${leadId}`);
  }

  // Aplica a memória de SLA ao mover (§5.2.1, §5.2.3).
  const now = new Date();
  const toSla = await getSlaConfig(client, toColumn);
  const { deadline, history } = computeSlaOnMove({
    fromColumn: before.column_id,
    toColumn,
    currentDeadline: before.sla_deadline,
    history: before.sla_history,
    toColumnSla: toSla,
    now,
  });

  const { rows } = await client.query<Lead>(
    `UPDATE mod_crm.leads
     SET column_id = $2, sla_deadline = $3, sla_history = $4::jsonb, updated_at = now()
     WHERE id = $1
     RETURNING id, person_contact_id, company_contact_id, assigned_to, column_id, status`,
    [leadId, toColumn, deadline, JSON.stringify(history)],
  );
  const lead = rows[0] as Lead;

  await addTimelineEntry(client, {
    leadId,
    userId: actorUserId,
    actionType: "stage",
    text: `Movido de ${before.column_id} para ${toColumn}.`,
  });

  await auditLog(client, {
    userId: actorUserId,
    module: "crm",
    action: "CRM_LEAD_MOVIDO",
    payloadBefore: { column_id: before.column_id },
    payloadAfter: { column_id: toColumn },
  });

  await publish(
    client,
    buildEnvelope("crm.lead.movido", "mod_crm", {
      lead_id: lead.id,
      person_contact_id: lead.person_contact_id,
      company_contact_id: lead.company_contact_id,
      from_column: before.column_id,
      to_column: toColumn,
    }),
  );

  return lead;
}

/**
 * Finaliza um lead como ganho ou perdido (Req 12.2, 12.3). Publica
 * `crm.lead.ganho` ou `crm.lead.perdido` com as referências de contato.
 *
 * @param client - Cliente PostgreSQL (em transação).
 * @param leadId - `id` do lead.
 * @param outcome - Resultado (`won` ou `lost`).
 * @param details - Valores (ganho) ou motivo (perdido).
 * @param actorUserId - Autor, ou `null` para SYSTEM.
 * @returns O lead finalizado.
 * @throws {Error} Se o lead não existe.
 */
export async function finalizeLead(
  client: PoolClient,
  leadId: string,
  outcome: "won" | "lost",
  details: { valueActivation?: number; valueMonthly?: number; lossReason?: string },
  actorUserId: string | null = null,
): Promise<Lead> {
  const current = await client.query<Lead>(
    `SELECT id, person_contact_id, company_contact_id, assigned_to, column_id, status
     FROM mod_crm.leads WHERE id = $1`,
    [leadId],
  );
  const before = current.rows[0];
  if (!before) {
    throw new Error(`Lead não encontrado: ${leadId}`);
  }

  const column = outcome === "won" ? "ganho" : "perdido";
  const { rows } = await client.query<Lead>(
    `UPDATE mod_crm.leads
     SET status = $2, column_id = $3, value_activation = $4, value_monthly = $5, updated_at = now()
     WHERE id = $1
     RETURNING id, person_contact_id, company_contact_id, assigned_to, column_id, status`,
    [
      leadId,
      outcome,
      column,
      details.valueActivation ?? null,
      details.valueMonthly ?? null,
    ],
  );
  const lead = rows[0] as Lead;

  const action = outcome === "won" ? "CRM_LEAD_GANHO" : "CRM_LEAD_PERDIDO";
  await auditLog(client, {
    userId: actorUserId,
    module: "crm",
    action,
    payloadAfter: { lead_id: lead.id, outcome },
  });

  const eventName = outcome === "won" ? "crm.lead.ganho" : "crm.lead.perdido";
  const payload: Record<string, unknown> = {
    lead_id: lead.id,
    person_contact_id: lead.person_contact_id,
    company_contact_id: lead.company_contact_id,
  };
  if (outcome === "won") {
    payload.value_activation = details.valueActivation ?? null;
    payload.value_monthly = details.valueMonthly ?? null;
  } else {
    payload.loss_reason = details.lossReason ?? null;
  }
  await publish(client, buildEnvelope(eventName, "mod_crm", payload));

  return lead;
}
