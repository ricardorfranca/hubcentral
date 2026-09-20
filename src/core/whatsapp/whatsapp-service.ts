/**
 * @file whatsapp-service.ts
 * @module core/whatsapp
 *
 * Serviço de WhatsApp via Evolution API. Cada usuário conecta seu próprio canal
 * (instância/credenciais em `core.user_channels`); valores globais em
 * `core.settings` (core.whatsapp.evolution.*) servem de fallback e são também o
 * padrão que o superadministrador define. É a única porta de saída de WhatsApp.
 */

import type { PoolClient } from "pg";
import { DomainError, ErrorCode } from "../errors.js";
import { resolveValue } from "../settings/settings-service.js";

/** Credenciais efetivas do canal de WhatsApp de um usuário. */
export interface WhatsappChannel {
  base_url: string;
  api_key: string;
  instance: string;
  enabled: boolean;
}

/** Canal do usuário como persistido em `core.user_channels`. */
export interface UserChannelRow {
  user_id: string;
  wa_evolution_url: string | null;
  wa_instance: string | null;
  wa_api_key: string | null;
  wa_enabled: boolean;
}

/** Normaliza um telefone para dígitos E.164 sem '+', assumindo Brasil. */
function toDigits(phone: string): string {
  let d = phone.replace(/\D/g, "");
  if (d.length <= 11) d = `55${d}`;
  return d;
}

/**
 * Lê o canal persistido de um usuário (ou `null` se nunca configurado).
 *
 * @param client - Cliente PostgreSQL.
 * @param userId - `user_id`.
 * @returns A linha do canal, ou `null`.
 */
export async function getUserChannel(client: PoolClient, userId: string): Promise<UserChannelRow | null> {
  const { rows } = await client.query<UserChannelRow>(
    `SELECT user_id, wa_evolution_url, wa_instance, wa_api_key, wa_enabled
     FROM core.user_channels WHERE user_id = $1`,
    [userId],
  );
  return rows[0] ?? null;
}

/**
 * Cria/atualiza (upsert) o canal de WhatsApp de um usuário. Usado tanto pelo
 * próprio usuário quanto pelo superadministrador (que pode inserir para outros).
 *
 * @param client - Cliente PostgreSQL.
 * @param userId - `user_id` alvo.
 * @param patch - Campos do canal (undefined preserva o valor atual).
 * @param actorUserId - Autor da alteração.
 * @returns O canal persistido.
 */
export async function upsertUserChannel(
  client: PoolClient,
  userId: string,
  patch: {
    wa_evolution_url?: string | null;
    wa_instance?: string | null;
    wa_api_key?: string | null;
    wa_enabled?: boolean;
  },
  actorUserId: string | null = null,
): Promise<UserChannelRow> {
  const { rows } = await client.query<UserChannelRow>(
    `INSERT INTO core.user_channels (user_id, wa_evolution_url, wa_instance, wa_api_key, wa_enabled, updated_by)
     VALUES ($1, $2, $3, $4, COALESCE($5, false), $6)
     ON CONFLICT (user_id) DO UPDATE SET
       wa_evolution_url = COALESCE($2, core.user_channels.wa_evolution_url),
       wa_instance      = COALESCE($3, core.user_channels.wa_instance),
       wa_api_key       = COALESCE($4, core.user_channels.wa_api_key),
       wa_enabled       = COALESCE($5, core.user_channels.wa_enabled),
       updated_at       = now(),
       updated_by       = $6
     RETURNING user_id, wa_evolution_url, wa_instance, wa_api_key, wa_enabled`,
    [
      userId,
      patch.wa_evolution_url ?? null,
      patch.wa_instance ?? null,
      patch.wa_api_key ?? null,
      patch.wa_enabled ?? null,
      actorUserId,
    ],
  );
  return rows[0] as UserChannelRow;
}

/**
 * Resolve as credenciais efetivas do canal de um usuário: valores próprios com
 * fallback para os globais (core.settings). Lança se faltar dado essencial.
 *
 * @param client - Cliente PostgreSQL.
 * @param userId - `user_id`.
 * @returns As credenciais efetivas.
 * @throws {DomainError} `WHATSAPP_NOT_CONFIGURED` se URL/instância/API key não resolvem.
 */
export async function resolveChannel(client: PoolClient, userId: string): Promise<WhatsappChannel> {
  const own = await getUserChannel(client, userId);
  const globalUrl = (await resolveValue(client, "core.whatsapp.evolution.base_url", "WA_EVOLUTION_URL")) ?? "";
  const globalKey = (await resolveValue(client, "core.whatsapp.evolution.api_key", "WA_EVOLUTION_KEY")) ?? "";
  const globalInstance = (await resolveValue(client, "core.whatsapp.evolution.default_instance", "WA_EVOLUTION_INSTANCE")) ?? "";

  const base_url = (own?.wa_evolution_url || globalUrl).replace(/\/+$/, "");
  const api_key = own?.wa_api_key || globalKey;
  const instance = own?.wa_instance || globalInstance;
  const enabled = own?.wa_enabled ?? false;

  if (!base_url || !api_key || !instance) {
    throw new DomainError(
      ErrorCode.WHATSAPP_NOT_CONFIGURED,
      "Canal de WhatsApp não configurado. Defina URL, instância e API key da Evolution (próprios ou globais).",
      {},
    );
  }
  return { base_url, api_key, instance, enabled };
}

/**
 * Envia uma mensagem de texto pelo canal de WhatsApp do usuário via Evolution API.
 *
 * @param client - Cliente PostgreSQL.
 * @param userId - Usuário remetente (dono do canal).
 * @param to - Telefone destino (nacional ou E.164; normalizado para BR).
 * @param text - Texto da mensagem.
 * @throws {DomainError} `WHATSAPP_NOT_CONFIGURED`/`WHATSAPP_ERROR`.
 */
export async function sendWhatsapp(
  client: PoolClient,
  userId: string,
  to: string,
  text: string,
): Promise<void> {
  const channel = await resolveChannel(client, userId);
  const number = toDigits(to);
  // Evolution API v2: POST /message/sendText/{instance} com apikey no header.
  const url = `${channel.base_url}/message/sendText/${encodeURIComponent(channel.instance)}`;
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: channel.api_key },
      body: JSON.stringify({ number, text }),
      signal: controller.signal,
    });
    clearTimeout(t);
    if (!res.ok) {
      throw new DomainError(ErrorCode.WHATSAPP_ERROR, `Evolution API respondeu ${res.status}.`, {});
    }
  } catch (e) {
    if (e instanceof DomainError) throw e;
    throw new DomainError(ErrorCode.WHATSAPP_ERROR, "Falha ao enviar mensagem via Evolution API.", {
      detail: e instanceof Error ? e.message : String(e),
    });
  }
}

/**
 * Verifica se o canal do usuário está alcançável (checa o estado da instância
 * na Evolution API). Não envia mensagem.
 *
 * @param client - Cliente PostgreSQL.
 * @param userId - `user_id`.
 * @returns `{ ok: true, instance }` se a instância respondeu.
 * @throws {DomainError} `WHATSAPP_NOT_CONFIGURED`/`WHATSAPP_ERROR`.
 */
export async function verifyChannel(
  client: PoolClient,
  userId: string,
): Promise<{ ok: true; instance: string }> {
  const channel = await resolveChannel(client, userId);
  const url = `${channel.base_url}/instance/connectionState/${encodeURIComponent(channel.instance)}`;
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, { headers: { apikey: channel.api_key }, signal: controller.signal });
    clearTimeout(t);
    if (!res.ok) {
      throw new DomainError(ErrorCode.WHATSAPP_ERROR, `Evolution API respondeu ${res.status}.`, {});
    }
    return { ok: true, instance: channel.instance };
  } catch (e) {
    if (e instanceof DomainError) throw e;
    throw new DomainError(ErrorCode.WHATSAPP_ERROR, "Não foi possível alcançar a Evolution API.", {
      detail: e instanceof Error ? e.message : String(e),
    });
  }
}
