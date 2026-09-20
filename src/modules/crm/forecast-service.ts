/**
 * @file forecast-service.ts
 * @module modules/crm
 *
 * Métricas de Receita Previsível: forecast ponderado, MRR/ARR novo, conversão
 * por estágio e segmentações por origem e por dono.
 */

import type { PoolClient } from "pg";

/**
 * Calcula o forecast ponderado das oportunidades abertas:
 * Σ((mrr×12 + one_time) × probabilidade/100). Também retorna o total de MRR
 * aberto e a contagem.
 *
 * @param client - Cliente PostgreSQL.
 * @returns Forecast ponderado, MRR aberto e número de oportunidades abertas.
 */
export async function weightedForecast(
  client: PoolClient,
): Promise<{ weighted: number; open_mrr: number; open_count: number }> {
  const { rows } = await client.query<{ weighted: string; open_mrr: string; open_count: string }>(
    `SELECT
       COALESCE(sum((mrr * 12 + one_time) * probability / 100.0), 0)::text AS weighted,
       COALESCE(sum(mrr), 0)::text AS open_mrr,
       count(*)::text AS open_count
     FROM mod_crm.opportunities
     WHERE status = 'open'`,
  );
  const r = rows[0]!;
  return { weighted: Number(r.weighted), open_mrr: Number(r.open_mrr), open_count: Number(r.open_count) };
}

/**
 * MRR e ARR novos do período (oportunidades ganhas no intervalo).
 *
 * @param client - Cliente PostgreSQL.
 * @param from - Início (inclusive).
 * @param to - Fim (exclusivo).
 * @returns MRR novo, ARR novo e valor único total.
 */
export async function newMrrArr(
  client: PoolClient,
  from: Date,
  to: Date,
): Promise<{ new_mrr: number; new_arr: number; one_time_total: number; won_count: number }> {
  const { rows } = await client.query<{ new_mrr: string; one_time_total: string; won_count: string }>(
    `SELECT
       COALESCE(sum(mrr), 0)::text AS new_mrr,
       COALESCE(sum(one_time), 0)::text AS one_time_total,
       count(*)::text AS won_count
     FROM mod_crm.opportunities
     WHERE status = 'won' AND updated_at >= $1 AND updated_at < $2`,
    [from.toISOString(), to.toISOString()],
  );
  const r = rows[0]!;
  const newMrr = Number(r.new_mrr);
  return { new_mrr: newMrr, new_arr: newMrr * 12, one_time_total: Number(r.one_time_total), won_count: Number(r.won_count) };
}

/**
 * Contagem de oportunidades por estágio (para funil de conversão).
 *
 * @param client - Cliente PostgreSQL.
 * @returns Lista de { stage_id, label, count } na ordem do pipeline.
 */
export async function conversionByStage(
  client: PoolClient,
): Promise<{ stage_id: string; label: string; count: number }[]> {
  const { rows } = await client.query<{ stage_id: string; label: string; count: string }>(
    `SELECT s.id AS stage_id, s.label, count(o.id)::text AS count
     FROM mod_crm.stages s
     LEFT JOIN mod_crm.opportunities o ON o.stage_id = s.id
     GROUP BY s.id, s.label, s.position
     ORDER BY s.position`,
  );
  return rows.map((r) => ({ stage_id: r.stage_id, label: r.label, count: Number(r.count) }));
}

/**
 * Pipeline aberto agregado por origem (inbound/outbound/indicação).
 *
 * @param client - Cliente PostgreSQL.
 * @returns Lista de { origin, count, mrr } das oportunidades abertas.
 */
export async function pipelineByOrigin(
  client: PoolClient,
): Promise<{ origin: string | null; count: number; mrr: number }[]> {
  const { rows } = await client.query<{ origin: string | null; count: string; mrr: string }>(
    `SELECT origin, count(*)::text AS count, COALESCE(sum(mrr), 0)::text AS mrr
     FROM mod_crm.opportunities WHERE status = 'open'
     GROUP BY origin ORDER BY origin NULLS LAST`,
  );
  return rows.map((r) => ({ origin: r.origin, count: Number(r.count), mrr: Number(r.mrr) }));
}

/**
 * Pipeline aberto agregado por dono (closer).
 *
 * @param client - Cliente PostgreSQL.
 * @returns Lista de { owner_user_id, count, weighted } das oportunidades abertas.
 */
export async function pipelineByOwner(
  client: PoolClient,
): Promise<{ owner_user_id: string | null; count: number; weighted: number }[]> {
  const { rows } = await client.query<{ owner_user_id: string | null; count: string; weighted: string }>(
    `SELECT owner_user_id, count(*)::text AS count,
            COALESCE(sum((mrr * 12 + one_time) * probability / 100.0), 0)::text AS weighted
     FROM mod_crm.opportunities WHERE status = 'open'
     GROUP BY owner_user_id`,
  );
  return rows.map((r) => ({ owner_user_id: r.owner_user_id, count: Number(r.count), weighted: Number(r.weighted) }));
}
