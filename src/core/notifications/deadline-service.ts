/**
 * @file deadline-service.ts
 * @module core/notifications
 *
 * Varredura de prazos do HUB Central. Percorre os módulos que possuem datas de
 * vencimento e gera alertas in-app na Central de Notificações (o sino) para o
 * responsável de cada item que esteja:
 *
 *   - "vencido"  (overdue): a data de vencimento já passou; ou
 *   - "a vencer" (warning): o vencimento está dentro da janela de alerta.
 *
 * A entrega reaproveita o serviço genérico {@link notify}. Cada alerta usa um
 * `source_event_id` determinístico derivado de (entidade, faixa, data) — assim
 * o índice único `uq_notifications_event_recipient` impede que o mesmo alerta
 * seja recriado a cada ciclo do worker. Quando o item transita de "a vencer"
 * para "vencido", a chave muda e um novo alerta (mais grave) é emitido; o
 * antigo permanece no histórico até o usuário marcá-lo como lido.
 *
 * Cobertura por módulo:
 *   - Projetos: tarefas (não finalizadas, com responsável) e projetos ativos.
 *   - CRM: atividades pendentes, oportunidades abertas e SLA de leads ativos.
 */

import type { Pool, PoolClient } from "pg";
import { withTransaction } from "../db/pool.js";
import { notify } from "./notification-service.js";
import { deterministicUuid } from "./deterministic-id.js";

/** Faixa de prazo de um item. */
export type DeadlineBucket = "overdue" | "warning";

/**
 * Janela (em dias) para alertar "a vencer" nos itens de CRM, que não possuem um
 * `warn_days` próprio (diferente de Projetos, onde cada tarefa/projeto define o
 * seu). Configurável via `DEADLINE_CRM_WARN_DAYS`; default de 2 dias.
 */
function crmWarnDays(): number {
  const parsed = Number(process.env.DEADLINE_CRM_WARN_DAYS);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 2;
}

/** Item de prazo normalizado, pronto para virar notificação. */
interface DeadlineItem {
  module: string;
  type: string;
  entityType: string;
  entityId: string;
  recipientUserId: string;
  /** Data de vencimento (YYYY-MM-DD) usada na chave de dedupe. */
  dueKey: string;
  bucket: DeadlineBucket;
  label: string;
  link: string;
}

/** Monta a mensagem exibida no sino conforme a faixa. */
function messageFor(kindLabel: string, name: string, bucket: DeadlineBucket): string {
  return bucket === "overdue"
    ? `${kindLabel} com prazo vencido: "${name}".`
    : `${kindLabel} com prazo próximo: "${name}".`;
}

/**
 * Tarefas de projeto não finalizadas, com responsável e prazo, cujo vencimento
 * já passou (overdue) ou está a `warn_days` (override da tarefa ou do projeto)
 * ou menos do vencimento (warning).
 */
async function scanProjectTasks(client: PoolClient): Promise<DeadlineItem[]> {
  const { rows } = await client.query<{
    id: string;
    project_id: string;
    title: string;
    assignee_user_id: string;
    due_date: string;
    warn_days: number;
    days_left: number;
  }>(
    `SELECT t.id,
            t.project_id,
            t.title,
            t.assignee_user_id,
            to_char(t.due_date, 'YYYY-MM-DD')            AS due_date,
            COALESCE(t.warn_days, p.warn_days)           AS warn_days,
            (t.due_date - CURRENT_DATE)                  AS days_left
       FROM mod_projetos.tasks t
       JOIN mod_projetos.projects p ON p.id = t.project_id
      WHERE t.status <> 'finalizada'
        AND t.due_date IS NOT NULL
        AND t.assignee_user_id IS NOT NULL
        AND (t.due_date - CURRENT_DATE) <= COALESCE(t.warn_days, p.warn_days)`,
  );
  return rows.map((r) => {
    const bucket: DeadlineBucket = r.days_left < 0 ? "overdue" : "warning";
    return {
      module: "projetos",
      type: `projetos.tarefa.prazo.${bucket}`,
      entityType: "task",
      entityId: r.id,
      recipientUserId: r.assignee_user_id,
      dueKey: r.due_date,
      bucket,
      label: messageFor("Tarefa", r.title, bucket),
      link: `/projetos/${r.project_id}/tarefas/${r.id}`,
    };
  });
}

/**
 * Projetos ativos com prazo total vencido ou a vencer (janela = `warn_days` do
 * projeto). Destinatário: o dono do projeto.
 */
async function scanProjects(client: PoolClient): Promise<DeadlineItem[]> {
  const { rows } = await client.query<{
    id: string;
    name: string;
    owner_user_id: string;
    due_date: string;
    days_left: number;
  }>(
    `SELECT p.id,
            p.name,
            p.owner_user_id,
            to_char(p.due_date, 'YYYY-MM-DD') AS due_date,
            (p.due_date - CURRENT_DATE)       AS days_left
       FROM mod_projetos.projects p
      WHERE p.status = 'ativo'
        AND p.due_date IS NOT NULL
        AND (p.due_date - CURRENT_DATE) <= p.warn_days`,
  );
  return rows.map((r) => {
    const bucket: DeadlineBucket = r.days_left < 0 ? "overdue" : "warning";
    return {
      module: "projetos",
      type: `projetos.projeto.prazo.${bucket}`,
      entityType: "project",
      entityId: r.id,
      recipientUserId: r.owner_user_id,
      dueKey: r.due_date,
      bucket,
      label: messageFor("Projeto", r.name, bucket),
      link: `/projetos/${r.id}`,
    };
  });
}

/**
 * Atividades de CRM pendentes com `due_at` vencido ou a vencer
 * ({@link crmWarnDays}). Destinatário: o responsável (`assigned_to`).
 */
async function scanCrmActivities(client: PoolClient): Promise<DeadlineItem[]> {
  const { rows } = await client.query<{
    id: string;
    subject: string;
    assigned_to: string;
    due_key: string;
    days_left: number;
  }>(
    `SELECT a.id,
            a.subject,
            a.assigned_to,
            to_char(a.due_at, 'YYYY-MM-DD')                            AS due_key,
            EXTRACT(DAY FROM (date_trunc('day', a.due_at) - date_trunc('day', now())))::int AS days_left
       FROM mod_crm.activities a
      WHERE a.status = 'pendente'
        AND a.due_at IS NOT NULL
        AND a.assigned_to IS NOT NULL
        AND a.due_at <= now() + ($1 || ' days')::interval`,
    [crmWarnDays()],
  );
  return rows.map((r) => {
    const bucket: DeadlineBucket = r.days_left < 0 ? "overdue" : "warning";
    return {
      module: "crm",
      type: `crm.atividade.prazo.${bucket}`,
      entityType: "activity",
      entityId: r.id,
      recipientUserId: r.assigned_to,
      dueKey: r.due_key,
      bucket,
      label: messageFor("Atividade", r.subject, bucket),
      // O SPA não tem rota de atividade individual; abre a lista de atividades.
      link: "/crm/atividades",
    };
  });
}

/**
 * Oportunidades abertas cujo fechamento previsto (`expected_close`) já passou ou
 * está a {@link crmWarnDays}. Destinatário: o dono (closer).
 */
async function scanCrmOpportunities(client: PoolClient): Promise<DeadlineItem[]> {
  const { rows } = await client.query<{
    id: string;
    name: string;
    owner_user_id: string;
    due_key: string;
    days_left: number;
  }>(
    `SELECT o.id,
            o.name,
            o.owner_user_id,
            to_char(o.expected_close, 'YYYY-MM-DD')                                AS due_key,
            EXTRACT(DAY FROM (date_trunc('day', o.expected_close) - date_trunc('day', now())))::int AS days_left
       FROM mod_crm.opportunities o
      WHERE o.status = 'open'
        AND o.expected_close IS NOT NULL
        AND o.owner_user_id IS NOT NULL
        AND o.expected_close <= now() + ($1 || ' days')::interval`,
    [crmWarnDays()],
  );
  return rows.map((r) => {
    const bucket: DeadlineBucket = r.days_left < 0 ? "overdue" : "warning";
    return {
      module: "crm",
      type: `crm.oportunidade.prazo.${bucket}`,
      entityType: "opportunity",
      entityId: r.id,
      recipientUserId: r.owner_user_id,
      dueKey: r.due_key,
      bucket,
      label: messageFor("Oportunidade", r.name, bucket),
      link: `/crm/oportunidades/${r.id}`,
    };
  });
}

/**
 * Leads ativos com SLA (`sla_deadline`) vencido ou a vencer
 * ({@link crmWarnDays}). Destinatário: o vendedor (`assigned_to`).
 */
async function scanCrmLeadSla(client: PoolClient): Promise<DeadlineItem[]> {
  const { rows } = await client.query<{
    id: string;
    assigned_to: string;
    due_key: string;
    days_left: number;
  }>(
    `SELECT l.id,
            l.assigned_to,
            to_char(l.sla_deadline, 'YYYY-MM-DD')                                  AS due_key,
            EXTRACT(DAY FROM (date_trunc('day', l.sla_deadline) - date_trunc('day', now())))::int AS days_left
       FROM mod_crm.leads l
      WHERE l.status = 'active'
        AND l.sla_deadline IS NOT NULL
        AND l.assigned_to IS NOT NULL
        AND l.sla_deadline <= now() + ($1 || ' days')::interval`,
    [crmWarnDays()],
  );
  return rows.map((r) => {
    const bucket: DeadlineBucket = r.days_left < 0 ? "overdue" : "warning";
    return {
      module: "crm",
      type: `crm.lead.sla.${bucket}`,
      entityType: "lead",
      entityId: r.id,
      recipientUserId: r.assigned_to,
      dueKey: r.due_key,
      bucket,
      label:
        bucket === "overdue"
          ? "SLA do lead vencido: atenda o quanto antes."
          : "SLA do lead próximo do vencimento.",
      // Sem rota de lead individual no SPA; abre o board principal do CRM.
      link: "/crm",
    };
  });
}

/**
 * Executa uma varredura completa usando um cliente já em transação e grava os
 * alertas pendentes. Exposto separadamente para permitir testes com ROLLBACK.
 *
 * @param client - Cliente PostgreSQL (transacional).
 * @returns Número de notificações efetivamente criadas (novas, não dedupe).
 */
export async function scanDeadlinesWithClient(client: PoolClient): Promise<number> {
  const items: DeadlineItem[] = [
    ...(await scanProjectTasks(client)),
    ...(await scanProjects(client)),
    ...(await scanCrmActivities(client)),
    ...(await scanCrmOpportunities(client)),
    ...(await scanCrmLeadSla(client)),
  ];

  let created = 0;
  for (const item of items) {
    const key = `deadline:${item.entityType}:${item.entityId}:${item.bucket}:${item.dueKey}`;
    const result = await notify(client, {
      recipientUserId: item.recipientUserId,
      module: item.module,
      type: item.type,
      message: item.label,
      entityType: item.entityType,
      entityId: item.entityId,
      link: item.link,
      sourceEventId: deterministicUuid(key),
    });
    if (result) created += 1;
  }
  return created;
}

/**
 * Executa uma varredura completa e grava os alertas de prazo pendentes na
 * Central de Notificações. Idempotente: o `source_event_id` determinístico
 * impede recriação do mesmo alerta em ciclos subsequentes.
 *
 * @param pool - Pool de conexões.
 * @returns Número de notificações efetivamente criadas neste ciclo (novas).
 */
export async function scanDeadlines(pool: Pool): Promise<number> {
  return withTransaction(pool, (client) => scanDeadlinesWithClient(client));
}
