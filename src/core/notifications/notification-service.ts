/**
 * @file notification-service.ts
 * @module core/notifications
 *
 * Central de Notificações in-app do núcleo. Serviço genérico reutilizável por
 * qualquer módulo: grava notificações para um destinatário, lista, marca como
 * lida e conta não lidas. A entrega é somente in-app nesta versão.
 */

import type { PoolClient } from "pg";

/** Notificação como persistida em `core.notifications`. */
export interface Notification {
  id: string;
  recipient_user_id: string;
  module: string;
  type: string;
  message: string;
  entity_type: string | null;
  entity_id: string | null;
  link: string | null;
  read: boolean;
  source_event_id: string | null;
  created_at: Date;
  read_at: Date | null;
}

const COLUMNS =
  "id, recipient_user_id, module, type, message, entity_type, entity_id, link, read, source_event_id, created_at, read_at";

/**
 * Cria uma notificação para um destinatário. Idempotente por
 * `(source_event_id, recipient_user_id)` quando `sourceEventId` é informado —
 * o reprocessamento do outbox não gera duplicatas.
 *
 * @param client - Cliente PostgreSQL.
 * @param input - Dados da notificação.
 * @returns A notificação criada, ou `null` se já existia (dedupe).
 */
export async function notify(
  client: PoolClient,
  input: {
    recipientUserId: string;
    module: string;
    type: string;
    message: string;
    entityType?: string | undefined;
    entityId?: string | undefined;
    link?: string | undefined;
    sourceEventId?: string | undefined;
  },
): Promise<Notification | null> {
  const { rows } = await client.query<Notification>(
    `INSERT INTO core.notifications
       (recipient_user_id, module, type, message, entity_type, entity_id, link, source_event_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (source_event_id, recipient_user_id) WHERE source_event_id IS NOT NULL
       DO NOTHING
     RETURNING ${COLUMNS}`,
    [
      input.recipientUserId,
      input.module,
      input.type,
      input.message,
      input.entityType ?? null,
      input.entityId ?? null,
      input.link ?? null,
      input.sourceEventId ?? null,
    ],
  );
  return rows[0] ?? null;
}

/**
 * Lista as notificações de um usuário, mais recentes primeiro.
 *
 * @param client - Cliente PostgreSQL.
 * @param userId - `user_id` do destinatário.
 * @param options - `unreadOnly` para filtrar não lidas; `limit` (default 50).
 * @returns As notificações do usuário.
 */
export async function listForUser(
  client: PoolClient,
  userId: string,
  options: { unreadOnly?: boolean; limit?: number } = {},
): Promise<Notification[]> {
  const limit = options.limit ?? 50;
  const { rows } = await client.query<Notification>(
    `SELECT ${COLUMNS} FROM core.notifications
     WHERE recipient_user_id = $1 ${options.unreadOnly ? "AND read = false" : ""}
     ORDER BY created_at DESC LIMIT $2`,
    [userId, limit],
  );
  return rows;
}

/**
 * Conta as notificações não lidas de um usuário.
 *
 * @param client - Cliente PostgreSQL.
 * @param userId - `user_id` do destinatário.
 * @returns Número de não lidas.
 */
export async function unreadCount(client: PoolClient, userId: string): Promise<number> {
  const { rows } = await client.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM core.notifications
     WHERE recipient_user_id = $1 AND read = false`,
    [userId],
  );
  return Number(rows[0]?.count ?? 0);
}

/**
 * Marca uma notificação do usuário como lida. Idempotente; só afeta
 * notificações do próprio usuário.
 *
 * @param client - Cliente PostgreSQL.
 * @param userId - `user_id` do destinatário.
 * @param notificationId - `id` da notificação.
 * @returns A notificação atualizada, ou `null` se não existe/não é do usuário.
 */
export async function markRead(
  client: PoolClient,
  userId: string,
  notificationId: string,
): Promise<Notification | null> {
  const { rows } = await client.query<Notification>(
    `UPDATE core.notifications SET read = true, read_at = now()
     WHERE id = $1 AND recipient_user_id = $2
     RETURNING ${COLUMNS}`,
    [notificationId, userId],
  );
  return rows[0] ?? null;
}

/**
 * Marca todas as notificações não lidas do usuário como lidas.
 *
 * @param client - Cliente PostgreSQL.
 * @param userId - `user_id` do destinatário.
 * @returns Número de notificações marcadas.
 */
export async function markAllRead(client: PoolClient, userId: string): Promise<number> {
  const { rowCount } = await client.query(
    `UPDATE core.notifications SET read = true, read_at = now()
     WHERE recipient_user_id = $1 AND read = false`,
    [userId],
  );
  return rowCount ?? 0;
}
