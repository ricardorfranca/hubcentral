/**
 * @file timeline-service.ts
 * @module modules/crm
 *
 * Timeline do lead (§4.2). Registro append-only de ações sobre um lead, com
 * snapshot do nome do autor (preservado mesmo se o usuário for removido).
 */

import type { PoolClient } from "pg";

/** Tipo de ação registrada na timeline. */
export type TimelineActionType = "stage" | "note" | "status" | "info" | "success" | "error";

/**
 * Registra uma entrada na timeline de um lead.
 *
 * @param client - Cliente PostgreSQL.
 * @param entry - Dados da entrada.
 * @returns O `id` da entrada criada.
 */
export async function addTimelineEntry(
  client: PoolClient,
  entry: {
    leadId: string;
    userId: string | null;
    actionType: TimelineActionType;
    text: string;
  },
): Promise<string> {
  // Snapshot do nome do autor a partir de core.users (ou 'SYSTEM').
  let userName = "SYSTEM";
  if (entry.userId) {
    const { rows } = await client.query<{ full_name: string }>(
      `SELECT full_name FROM core.users WHERE id = $1`,
      [entry.userId],
    );
    userName = rows[0]?.full_name ?? "SYSTEM";
  }

  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO mod_crm.lead_timeline (lead_id, user_id, user_name, action_type, text)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [entry.leadId, entry.userId, userName, entry.actionType, entry.text],
  );
  return rows[0]!.id;
}

/**
 * Lista a timeline de um lead em ordem cronológica.
 *
 * @param client - Cliente PostgreSQL.
 * @param leadId - `id` do lead.
 * @returns Entradas da timeline.
 */
export async function getTimeline(
  client: PoolClient,
  leadId: string,
): Promise<{ action_type: string; text: string; user_name: string | null; timestamp: Date }[]> {
  const { rows } = await client.query<{ action_type: string; text: string; user_name: string | null; timestamp: Date }>(
    `SELECT action_type, text, user_name, "timestamp"
     FROM mod_crm.lead_timeline WHERE lead_id = $1 ORDER BY "timestamp"`,
    [leadId],
  );
  return rows;
}
