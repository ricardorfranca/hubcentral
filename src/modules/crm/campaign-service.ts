/**
 * @file campaign-service.ts
 * @module modules/crm
 *
 * Campanhas do CRM (§6). Criação com corpo text/html independentes,
 * segmentação por etiquetas via Base Central (retorna apenas contact_id) e
 * disparo que emite `crm.campanha.disparada`.
 */

import type { PoolClient } from "pg";
import { evaluateSegment } from "../../core/contacts/segment-service.js";
import { log as auditLog } from "../../core/audit/audit-logger.js";
import { publish, buildEnvelope } from "../../core/events/event-bus.js";

/** Canal de disparo. */
export type CampaignChannel = "email" | "whatsapp" | "sms";

/** Campanha persistida. */
export interface Campaign {
  id: string;
  name: string;
  tags: string[];
  channels: string[];
  status: "draft" | "active" | "paused";
  subject: string | null;
  body_type: "text" | "html";
  body_text: string | null;
  body_html: string | null;
}

/** Colunas de campanha retornadas. */
const CAMPAIGN_COLUMNS =
  "id, name, tags, channels, status, subject, body_type, body_text, body_html";

/**
 * Cria uma campanha. Os corpos text e html são armazenados separadamente e
 * preservados independentemente (§6.3).
 *
 * @param client - Cliente PostgreSQL.
 * @param input - Dados da campanha.
 * @param actorUserId - Autor.
 * @returns A campanha criada.
 */
export async function createCampaign(
  client: PoolClient,
  input: {
    name: string;
    tags: string[];
    channels: CampaignChannel[];
    subject?: string;
    bodyType?: "text" | "html";
    bodyText?: string;
    bodyHtml?: string;
  },
  actorUserId: string | null = null,
): Promise<Campaign> {
  const { rows } = await client.query<Campaign>(
    `INSERT INTO mod_crm.campaigns (name, tags, channels, subject, body_type, body_text, body_html, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING ${CAMPAIGN_COLUMNS}`,
    [
      input.name,
      input.tags,
      input.channels,
      input.subject ?? null,
      input.bodyType ?? "text",
      input.bodyText ?? null,
      input.bodyHtml ?? null,
      actorUserId,
    ],
  );
  const campaign = rows[0] as Campaign;

  await auditLog(client, {
    userId: actorUserId,
    module: "crm",
    action: "CRM_CAMPANHA_CRIADA",
    payloadAfter: { campaign_id: campaign.id, name: campaign.name },
  });

  return campaign;
}

/**
 * Resolve o público-alvo de uma campanha: contatos que possuem TODAS as
 * categorias correspondentes às etiquetas da campanha (§6.1). A segmentação
 * roda na Base Central e retorna apenas `contact_id` (Req 6.3).
 *
 * @param client - Cliente PostgreSQL.
 * @param categoryIds - Categorias-alvo (mapeadas das etiquetas da campanha).
 * @returns `contact_id` do público.
 */
export async function resolveAudience(
  client: PoolClient,
  categoryIds: string[],
): Promise<string[]> {
  return evaluateSegment(client, { categories: categoryIds });
}

/** Variáveis de personalização suportadas no corpo (§6.3). */
const TEMPLATE_VARS = ["nome_lead", "empresa_lead", "vendedor", "produto"] as const;

/**
 * Substitui as variáveis `{{var}}` do corpo pelos valores fornecidos. Variáveis
 * sem valor são substituídas por string vazia.
 *
 * @param body - Corpo com placeholders.
 * @param values - Mapa de valores por nome de variável.
 * @returns O corpo com as variáveis resolvidas.
 */
export function renderTemplate(body: string, values: Partial<Record<(typeof TEMPLATE_VARS)[number], string>>): string {
  return body.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => {
    const key = name as (typeof TEMPLATE_VARS)[number];
    return TEMPLATE_VARS.includes(key) ? values[key] ?? "" : "";
  });
}

/**
 * Dispara uma campanha para um público de contatos, emitindo o evento
 * `crm.campanha.disparada` com a contagem (§6, §10). Não envia e-mail real
 * (isso depende do canal configurado); registra a intenção e audita.
 *
 * @param client - Cliente PostgreSQL.
 * @param campaignId - `id` da campanha.
 * @param channel - Canal do disparo.
 * @param audience - `contact_id` do público-alvo.
 * @param actorUserId - Autor.
 * @returns A quantidade de contatos alvo.
 */
export async function dispatchCampaign(
  client: PoolClient,
  campaignId: string,
  channel: CampaignChannel,
  audience: string[],
  actorUserId: string | null = null,
): Promise<number> {
  await auditLog(client, {
    userId: actorUserId,
    module: "crm",
    action: "CRM_CAMPANHA_DISPARADA",
    payloadAfter: { campaign_id: campaignId, channel, lead_count: audience.length },
  });

  await publish(
    client,
    buildEnvelope("crm.campanha.disparada", "mod_crm", {
      campaign_id: campaignId,
      channel,
      lead_count: audience.length,
    }),
  );

  return audience.length;
}
