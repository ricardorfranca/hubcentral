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
import { sendEmail } from "../../core/email/email-service.js";
import { sendSms } from "../../core/sms/sms-service.js";

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
 * Lista as campanhas, mais recentes primeiro.
 *
 * @param client - Cliente PostgreSQL.
 * @returns Lista de campanhas.
 */
export async function listCampaigns(client: PoolClient): Promise<Campaign[]> {
  const { rows } = await client.query<Campaign>(
    `SELECT ${CAMPAIGN_COLUMNS} FROM mod_crm.campaigns ORDER BY created_at DESC`,
  );
  return rows;
}

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
 * Atualiza uma campanha (nome, etiquetas, canais, status, assunto e corpos).
 * Apenas os campos presentes são alterados. Audita.
 *
 * @param client - Cliente PostgreSQL.
 * @param id - `id` da campanha.
 * @param patch - Campos a alterar.
 * @param actorUserId - Autor.
 * @returns A campanha atualizada, ou `null` se não existe.
 */
export async function updateCampaign(
  client: PoolClient,
  id: string,
  patch: {
    name?: string;
    tags?: string[];
    channels?: CampaignChannel[];
    status?: "draft" | "active" | "paused";
    subject?: string | null;
    bodyType?: "text" | "html";
    bodyText?: string | null;
    bodyHtml?: string | null;
  },
  actorUserId: string | null = null,
): Promise<Campaign | null> {
  const { rows } = await client.query<Campaign>(
    `UPDATE mod_crm.campaigns SET
       name = COALESCE($2, name),
       tags = COALESCE($3, tags),
       channels = COALESCE($4, channels),
       status = COALESCE($5, status),
       subject = COALESCE($6, subject),
       body_type = COALESCE($7, body_type),
       body_text = COALESCE($8, body_text),
       body_html = COALESCE($9, body_html)
     WHERE id = $1
     RETURNING ${CAMPAIGN_COLUMNS}`,
    [
      id, patch.name ?? null, patch.tags ?? null, patch.channels ?? null, patch.status ?? null,
      patch.subject ?? null, patch.bodyType ?? null, patch.bodyText ?? null, patch.bodyHtml ?? null,
    ],
  );
  const campaign = rows[0] ?? null;
  if (campaign) {
    await auditLog(client, {
      userId: actorUserId, module: "crm", action: "CRM_CAMPANHA_EDITADA",
      payloadAfter: { campaign_id: id },
    });
  }
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
): Promise<{ lead_count: number; delivered: number; failed: number }> {
  let delivered = 0;
  let failed = 0;

  // Carrega a campanha para montar o conteúdo do envio.
  const { rows } = await client.query<Campaign>(
    `SELECT ${CAMPAIGN_COLUMNS} FROM mod_crm.campaigns WHERE id = $1`,
    [campaignId],
  );
  const campaign = rows[0];

  if (campaign && (channel === "email" || channel === "sms") && audience.length > 0) {
    // Resolve dados de contato do público (nome/e-mail/telefone) da Base Central.
    const contacts = await client.query<{ id: string; full_name: string | null; email: string | null; phone: string | null }>(
      `SELECT id, full_name, email, phone FROM core.contacts WHERE id = ANY($1::uuid[])`,
      [audience],
    );

    for (const contact of contacts.rows) {
      const text = renderTemplate(campaign.body_text ?? "", { nome_lead: contact.full_name ?? "" });
      try {
        if (channel === "email" && contact.email) {
          await sendEmail(client, {
            to: contact.email,
            subject: campaign.subject ?? campaign.name,
            ...(campaign.body_type === "html" && campaign.body_html
              ? { html: renderTemplate(campaign.body_html, { nome_lead: contact.full_name ?? "" }) }
              : { text }),
          });
          delivered += 1;
        } else if (channel === "sms" && contact.phone) {
          await sendSms(client, contact.phone, text);
          delivered += 1;
        } else {
          failed += 1; // sem canal de contato disponível
        }
      } catch {
        failed += 1; // best-effort: uma falha não interrompe a campanha
      }
    }
  }

  await auditLog(client, {
    userId: actorUserId,
    module: "crm",
    action: "CRM_CAMPANHA_DISPARADA",
    payloadAfter: { campaign_id: campaignId, channel, lead_count: audience.length, delivered, failed },
  });

  await publish(
    client,
    buildEnvelope("crm.campanha.disparada", "mod_crm", {
      campaign_id: campaignId,
      channel,
      lead_count: audience.length,
    }),
  );

  return { lead_count: audience.length, delivered, failed };
}
