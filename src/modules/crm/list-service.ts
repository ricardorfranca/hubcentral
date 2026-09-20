/**
 * @file list-service.ts
 * @module modules/crm
 *
 * Listas configuráveis do CRM (§7.8). Alimentam dropdowns de etiquetas,
 * origens, produtos, parceiros e motivos de perda. Itens desativados não
 * aparecem em novos cadastros, mas são preservados para histórico.
 */

import type { PoolClient } from "pg";

/** Tipos de lista configurável. */
export type ListType = "tag" | "source" | "product" | "partner" | "loss_reason";

/** Item de lista configurável. */
export interface ListItem {
  id: string;
  type: ListType;
  value: string;
  active: boolean;
}

/**
 * Adiciona um item a uma lista (idempotente por (type, value): reativa se já
 * existir desativado).
 *
 * @param client - Cliente PostgreSQL.
 * @param type - Tipo da lista.
 * @param value - Valor do item.
 * @returns O item adicionado/reativado.
 */
export async function addListItem(
  client: PoolClient,
  type: ListType,
  value: string,
): Promise<ListItem> {
  const { rows } = await client.query<ListItem>(
    `INSERT INTO mod_crm.lists (type, value, active)
     VALUES ($1, $2, true)
     ON CONFLICT (type, value) DO UPDATE SET active = true
     RETURNING id, type, value, active`,
    [type, value],
  );
  return rows[0] as ListItem;
}

/**
 * Desativa um item de lista (não aparece em novos cadastros).
 *
 * @param client - Cliente PostgreSQL.
 * @param id - `id` do item.
 * @returns `true` se desativou.
 */
export async function deactivateListItem(client: PoolClient, id: string): Promise<boolean> {
  const { rowCount } = await client.query(
    `UPDATE mod_crm.lists SET active = false WHERE id = $1`,
    [id],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * Lista os itens ativos de um tipo, ordenados por valor.
 *
 * @param client - Cliente PostgreSQL.
 * @param type - Tipo da lista.
 * @returns Itens ativos do tipo.
 */
export async function listItems(client: PoolClient, type: ListType): Promise<ListItem[]> {
  const { rows } = await client.query<ListItem>(
    `SELECT id, type, value, active FROM mod_crm.lists
     WHERE type = $1 AND active = true ORDER BY value`,
    [type],
  );
  return rows;
}
