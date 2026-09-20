/**
 * @file sla-service.ts
 * @module modules/crm
 *
 * Sistema de SLA do CRM (§5.2). Configura o SLA por etapa, calcula o deadline
 * ao mover um lead — com MEMÓRIA entre etapas (o prazo não reinicia ao retornar)
 * — e classifica a urgência (ok/warning/critical).
 */

import type { PoolClient } from "pg";

/** Unidade de tempo do SLA. */
export type SlaUnit = "minutes" | "hours" | "days";

/** Configuração de SLA de uma etapa. */
export interface SlaConfig {
  column_id: string;
  value: number;
  unit: SlaUnit;
}

/** Nível de urgência calculado (§5.2.2). */
export type UrgencyLevel = "ok" | "warning" | "critical";

/**
 * Converte uma configuração de SLA em milissegundos.
 *
 * @param value - Valor numérico.
 * @param unit - Unidade.
 * @returns Duração em milissegundos.
 */
export function slaToMs(value: number, unit: SlaUnit): number {
  const factor = unit === "minutes" ? 60_000 : unit === "hours" ? 3_600_000 : 86_400_000;
  return value * factor;
}

/**
 * Classifica a urgência a partir do tempo restante e do total do SLA (§5.2.2):
 * ok > 50%, warning 25–50%, critical < 25% ou vencido.
 *
 * @param remainingMs - Tempo restante em ms (pode ser negativo se vencido).
 * @param totalMs - Duração total configurada do SLA em ms.
 * @returns O nível de urgência.
 */
export function urgencyLevel(remainingMs: number, totalMs: number): UrgencyLevel {
  if (totalMs <= 0) return "ok";
  const ratio = remainingMs / totalMs;
  if (ratio >= 0.5) return "ok";
  if (ratio >= 0.25) return "warning";
  return "critical";
}

/**
 * Lê a configuração de SLA de uma etapa.
 *
 * @param client - Cliente PostgreSQL.
 * @param columnId - Etapa do pipeline.
 * @returns A configuração, ou `null` se a etapa não tem SLA.
 */
export async function getSlaConfig(client: PoolClient, columnId: string): Promise<SlaConfig | null> {
  const { rows } = await client.query<SlaConfig>(
    `SELECT column_id, value, unit FROM mod_crm.sla_config WHERE column_id = $1`,
    [columnId],
  );
  return rows[0] ?? null;
}

/**
 * Define/atualiza o SLA de uma etapa e recalcula os deadlines dos leads ativos
 * naquela etapa (§5.2.4): se o tempo restante for maior que o novo total, o
 * deadline é reduzido; caso contrário é mantido.
 *
 * @param client - Cliente PostgreSQL.
 * @param columnId - Etapa do pipeline.
 * @param value - Valor do SLA.
 * @param unit - Unidade.
 * @param actorUserId - Autor da alteração.
 * @param now - Instante atual (injetável para teste).
 */
export async function setSlaConfig(
  client: PoolClient,
  columnId: string,
  value: number,
  unit: SlaUnit,
  actorUserId: string | null = null,
  now: Date = new Date(),
): Promise<void> {
  await client.query(
    `INSERT INTO mod_crm.sla_config (column_id, value, unit, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (column_id) DO UPDATE SET value = $2, unit = $3, updated_by = $4, updated_at = $5`,
    [columnId, value, unit, actorUserId, now],
  );

  const newTotalMs = slaToMs(value, unit);
  const newDeadline = new Date(now.getTime() + newTotalMs);
  // Reduz o deadline apenas dos leads cujo tempo restante excede o novo total.
  await client.query(
    `UPDATE mod_crm.leads
     SET sla_deadline = $3
     WHERE column_id = $1 AND status = 'active'
       AND sla_deadline IS NOT NULL AND sla_deadline > $2`,
    [columnId, newDeadline.toISOString(), newDeadline.toISOString()],
  );
}

/**
 * Calcula o novo `sla_deadline` e a `sla_history` atualizada ao mover um lead
 * para uma etapa, aplicando a MEMÓRIA de SLA (§5.2.1, §5.2.3):
 *  - ao SAIR da etapa atual, salva o deadline corrente em `sla_history`;
 *  - ao ENTRAR na nova etapa, restaura o deadline salvo se houver memória;
 *  - se não houver memória e a etapa tem SLA, `deadline = now + total`;
 *  - se a etapa não tem SLA, `deadline = null`.
 *
 * Função pura: recebe o estado atual e a config, devolve o próximo estado.
 * A persistência é feita pelo chamador (lead-service.moveLead).
 *
 * @param params - Estado atual e destino.
 * @returns Novo deadline (ou null) e a history atualizada.
 */
export function computeSlaOnMove(params: {
  fromColumn: string;
  toColumn: string;
  currentDeadline: string | null;
  history: Record<string, string>;
  toColumnSla: SlaConfig | null;
  now: Date;
}): { deadline: string | null; history: Record<string, string> } {
  const history = { ...params.history };

  // Ao sair: memoriza o deadline atual da etapa de origem (se houver).
  if (params.currentDeadline) {
    history[params.fromColumn] = params.currentDeadline;
  }

  // Ao entrar: restaura memória, se houver.
  const remembered = history[params.toColumn];
  if (remembered) {
    return { deadline: remembered, history };
  }

  // Sem memória: usa o SLA da etapa de destino, se configurado.
  if (params.toColumnSla) {
    const totalMs = slaToMs(params.toColumnSla.value, params.toColumnSla.unit);
    const deadline = new Date(params.now.getTime() + totalMs).toISOString();
    return { deadline, history };
  }

  // Etapa sem SLA.
  return { deadline: null, history };
}
