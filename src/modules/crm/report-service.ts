/**
 * @file report-service.ts
 * @module modules/crm
 *
 * Relatórios operacionais do CRM (§8): fechamentos do mês, motivos de perda,
 * performance por vendedor e cumprimento de SLA. Consultas agregadas sobre
 * mod_crm.leads.
 */

import type { PoolClient } from "pg";

/**
 * Relatório de fechamentos do mês: leads ganhos/perdidos e soma dos valores de
 * ativação e mensalidade dos ganhos, dentro de um intervalo.
 *
 * @param client - Cliente PostgreSQL.
 * @param from - Início do intervalo (inclusive).
 * @param to - Fim do intervalo (exclusivo).
 * @returns Totais de ganhos, perdidos e valores.
 */
export async function closingsReport(
  client: PoolClient,
  from: Date,
  to: Date,
): Promise<{ won: number; lost: number; total_activation: number; total_monthly: number }> {
  const { rows } = await client.query<{ won: string; lost: string; total_activation: string; total_monthly: string }>(
    `SELECT
       count(*) FILTER (WHERE status = 'won')::text AS won,
       count(*) FILTER (WHERE status = 'lost')::text AS lost,
       COALESCE(sum(value_activation) FILTER (WHERE status = 'won'), 0)::text AS total_activation,
       COALESCE(sum(value_monthly) FILTER (WHERE status = 'won'), 0)::text AS total_monthly
     FROM mod_crm.leads
     WHERE updated_at >= $1 AND updated_at < $2`,
    [from.toISOString(), to.toISOString()],
  );
  const r = rows[0]!;
  return {
    won: Number(r.won),
    lost: Number(r.lost),
    total_activation: Number(r.total_activation),
    total_monthly: Number(r.total_monthly),
  };
}

/**
 * Relatório de motivos de perda: contagem de leads perdidos por motivo.
 *
 * @param client - Cliente PostgreSQL.
 * @returns Lista de { loss_reason, count } ordenada por contagem desc.
 */
export async function lossReasonsReport(
  client: PoolClient,
): Promise<{ loss_reason: string | null; count: number }[]> {
  const { rows } = await client.query<{ loss_reason: string | null; count: string }>(
    `SELECT loss_reason, count(*)::text AS count
     FROM mod_crm.leads WHERE status = 'lost'
     GROUP BY loss_reason ORDER BY count(*) DESC`,
  );
  return rows.map((r) => ({ loss_reason: r.loss_reason, count: Number(r.count) }));
}

/**
 * Relatório de performance por vendedor: total de leads, ganhos e perdidos por
 * `assigned_to`.
 *
 * @param client - Cliente PostgreSQL.
 * @returns Lista por vendedor.
 */
export async function performanceReport(
  client: PoolClient,
): Promise<{ assigned_to: string | null; total: number; won: number; lost: number }[]> {
  const { rows } = await client.query<{ assigned_to: string | null; total: string; won: string; lost: string }>(
    `SELECT assigned_to,
            count(*)::text AS total,
            count(*) FILTER (WHERE status = 'won')::text AS won,
            count(*) FILTER (WHERE status = 'lost')::text AS lost
     FROM mod_crm.leads
     GROUP BY assigned_to`,
  );
  return rows.map((r) => ({
    assigned_to: r.assigned_to,
    total: Number(r.total),
    won: Number(r.won),
    lost: Number(r.lost),
  }));
}

/**
 * Relatório de cumprimento de SLA: quantos leads ativos com SLA estão vencidos
 * versus dentro do prazo, num dado instante.
 *
 * @param client - Cliente PostgreSQL.
 * @param now - Instante de referência.
 * @returns Contagem de vencidos e no prazo.
 */
export async function slaReport(
  client: PoolClient,
  now: Date = new Date(),
): Promise<{ overdue: number; on_time: number }> {
  const { rows } = await client.query<{ overdue: string; on_time: string }>(
    `SELECT
       count(*) FILTER (WHERE sla_deadline < $1)::text AS overdue,
       count(*) FILTER (WHERE sla_deadline >= $1)::text AS on_time
     FROM mod_crm.leads
     WHERE status = 'active' AND sla_deadline IS NOT NULL`,
    [now.toISOString()],
  );
  const r = rows[0]!;
  return { overdue: Number(r.overdue), on_time: Number(r.on_time) };
}
