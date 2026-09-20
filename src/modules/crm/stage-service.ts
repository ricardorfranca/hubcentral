/**
 * @file stage-service.ts
 * @module modules/crm
 *
 * Serviço de estágios configuráveis do pipeline (CRM 2.0). Estágios definem a
 * ordem do funil e a probabilidade usada no forecast ponderado.
 */

import type { PoolClient } from "pg";

/** Estágio do pipeline. */
export interface Stage {
  id: string;
  label: string;
  position: number;
  probability: number;
  terminal: boolean;
  won_lost: "won" | "lost" | null;
}

/**
 * Lista os estágios do pipeline em ordem de posição.
 *
 * @param client - Cliente PostgreSQL.
 * @returns Estágios ordenados.
 */
export async function listStages(client: PoolClient): Promise<Stage[]> {
  const { rows } = await client.query<Stage>(
    `SELECT id, label, position, probability, terminal, won_lost
     FROM mod_crm.stages ORDER BY position`,
  );
  return rows;
}

/**
 * Atualiza a probabilidade e/ou o rótulo de um estágio não terminal.
 *
 * @param client - Cliente PostgreSQL.
 * @param id - `id` do estágio.
 * @param patch - Campos a atualizar (label, probability).
 * @returns O estágio atualizado, ou `null` se não existe.
 */
export async function updateStage(
  client: PoolClient,
  id: string,
  patch: { label?: string; probability?: number },
): Promise<Stage | null> {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (patch.label !== undefined) { params.push(patch.label); sets.push(`label = $${params.length}`); }
  if (patch.probability !== undefined) { params.push(patch.probability); sets.push(`probability = $${params.length}`); }
  if (sets.length === 0) {
    const { rows } = await client.query<Stage>(
      `SELECT id, label, position, probability, terminal, won_lost FROM mod_crm.stages WHERE id = $1`,
      [id],
    );
    return rows[0] ?? null;
  }
  params.push(id);
  const { rows } = await client.query<Stage>(
    `UPDATE mod_crm.stages SET ${sets.join(", ")} WHERE id = $${params.length}
     RETURNING id, label, position, probability, terminal, won_lost`,
    params,
  );
  return rows[0] ?? null;
}
