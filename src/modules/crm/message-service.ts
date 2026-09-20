/**
 * @file message-service.ts
 * @module modules/crm
 *
 * Mensageria interna do CRM (§4.4, §9): canal de equipe (`group`) e mensagens
 * diretas (`dm_{min}_{max}`), alertas de SLA e alertas de gerente vinculados a
 * um lead.
 */

import type { PoolClient } from "pg";

/** Tipo de mensagem. */
export type MessageType = "message" | "sla_alert" | "system";

/** Identificador do canal de equipe. */
export const GROUP_CONVERSATION = "group";

/**
 * Calcula o `conversation_id` de uma DM entre dois usuários, de forma
 * determinística (independe da ordem): `dm_{min}_{max}`.
 *
 * @param a - `user_id` A.
 * @param b - `user_id` B.
 * @returns O `conversation_id` da DM.
 */
export function dmConversationId(a: string, b: string): string {
  const [min, max] = a < b ? [a, b] : [b, a];
  return `dm_${min}_${max}`;
}

/** Mensagem persistida. */
export interface Message {
  id: string;
  from_user_id: string | null;
  from_user_name: string | null;
  conversation_id: string;
  text: string;
  type: MessageType;
  lead_id: string | null;
  timestamp: Date;
}

/** Colunas de mensagem retornadas. */
const MSG_COLUMNS =
  "id, from_user_id, from_user_name, conversation_id, text, type, lead_id, \"timestamp\"";

/**
 * Resolve o snapshot do nome de um usuário (ou 'Sistema' se nulo).
 *
 * @param client - Cliente PostgreSQL.
 * @param userId - `user_id`, ou `null` para Sistema.
 * @returns Nome para snapshot.
 */
async function snapshotName(client: PoolClient, userId: string | null): Promise<string> {
  if (!userId) return "Sistema";
  const { rows } = await client.query<{ full_name: string }>(
    `SELECT full_name FROM core.users WHERE id = $1`,
    [userId],
  );
  return rows[0]?.full_name ?? "Sistema";
}

/**
 * Envia uma mensagem para uma conversa (canal `group` ou DM).
 *
 * @param client - Cliente PostgreSQL.
 * @param input - Dados da mensagem.
 * @returns A mensagem criada.
 */
export async function sendMessage(
  client: PoolClient,
  input: {
    fromUserId: string | null;
    conversationId: string;
    text: string;
    type?: MessageType;
    leadId?: string | null;
  },
): Promise<Message> {
  const name = await snapshotName(client, input.fromUserId);
  const { rows } = await client.query<Message>(
    `INSERT INTO mod_crm.messages (from_user_id, from_user_name, conversation_id, text, type, lead_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING ${MSG_COLUMNS}`,
    [input.fromUserId, name, input.conversationId, input.text, input.type ?? "message", input.leadId ?? null],
  );
  return rows[0] as Message;
}

/**
 * Lista as mensagens de uma conversa em ordem cronológica.
 *
 * @param client - Cliente PostgreSQL.
 * @param conversationId - Identificador da conversa.
 * @returns Mensagens da conversa.
 */
export async function listMessages(client: PoolClient, conversationId: string): Promise<Message[]> {
  const { rows } = await client.query<Message>(
    `SELECT ${MSG_COLUMNS} FROM mod_crm.messages
     WHERE conversation_id = $1 ORDER BY "timestamp"`,
    [conversationId],
  );
  return rows;
}

/**
 * Posta um alerta automático de SLA no canal da equipe (§5.3), com type
 * `sla_alert`, opcionalmente vinculado a um lead. Autor = Sistema.
 *
 * @param client - Cliente PostgreSQL.
 * @param text - Texto do alerta (nome do lead, empresa, produto, etapa, tempo).
 * @param leadId - Lead relacionado (opcional).
 * @returns A mensagem de alerta criada.
 */
export async function postSlaAlert(
  client: PoolClient,
  text: string,
  leadId: string | null = null,
): Promise<Message> {
  return sendMessage(client, {
    fromUserId: null,
    conversationId: GROUP_CONVERSATION,
    text,
    type: "sla_alert",
    leadId,
  });
}

/**
 * Envia um alerta de gerente ao vendedor responsável, como DM vinculada a um
 * lead (§5.7). O destinatário recebe; o remetente não.
 *
 * @param client - Cliente PostgreSQL.
 * @param fromUserId - `user_id` do gerente (remetente).
 * @param toUserId - `user_id` do vendedor (destinatário).
 * @param text - Mensagem contextualizada.
 * @param leadId - Lead relacionado.
 * @returns A mensagem (DM) criada.
 */
export async function sendManagerAlert(
  client: PoolClient,
  fromUserId: string,
  toUserId: string,
  text: string,
  leadId: string,
): Promise<Message> {
  return sendMessage(client, {
    fromUserId,
    conversationId: dmConversationId(fromUserId, toUserId),
    text,
    type: "message",
    leadId,
  });
}
