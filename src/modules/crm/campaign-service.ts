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
import { sendWhatsapp } from "../../core/whatsapp/whatsapp-service.js";

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
  /** Dispara automaticamente após o cadastro. */
  auto_dispatch: boolean;
  /** Quando começar (NULL = imediato). */
  scheduled_at: string | null;
  /** Mensagens por ciclo. */
  batch_size: number;
  /** Teto de mensagens por hora (NULL = sem teto). */
  per_hour: number | null;
  /** Estado do disparo automático. */
  dispatch_status: "idle" | "queued" | "running" | "done" | "error";
  /** Total já enviado na execução corrente. */
  sent_count: number;
}

/** Colunas de campanha retornadas. */
const CAMPAIGN_COLUMNS =
  "id, name, tags, channels, status, subject, body_type, body_text, body_html, " +
  "auto_dispatch, scheduled_at, batch_size, per_hour, dispatch_status, sent_count";

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
    autoDispatch?: boolean;
    scheduledAt?: string | null;
    batchSize?: number;
    perHour?: number | null;
  },
  actorUserId: string | null = null,
): Promise<Campaign> {
  const { rows } = await client.query<Campaign>(
    `INSERT INTO mod_crm.campaigns
       (name, tags, channels, subject, body_type, body_text, body_html, created_by,
        auto_dispatch, scheduled_at, batch_size, per_hour)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, COALESCE($11, 50), $12)
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
      input.autoDispatch ?? false,
      input.scheduledAt ?? null,
      input.batchSize ?? null,
      input.perHour ?? null,
    ],
  );
  const campaign = rows[0] as Campaign;

  await auditLog(client, {
    userId: actorUserId,
    module: "crm",
    action: "CRM_CAMPANHA_CRIADA",
    payloadAfter: { campaign_id: campaign.id, name: campaign.name, auto_dispatch: campaign.auto_dispatch },
  });

  // Disparo automático: enfileira o público imediatamente após o cadastro; o
  // worker consome a fila respeitando batch_size/per_hour a partir de scheduled_at.
  if (campaign.auto_dispatch) {
    await enqueueCampaign(client, campaign.id, actorUserId);
  }

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
    autoDispatch?: boolean;
    scheduledAt?: string | null;
    batchSize?: number;
    perHour?: number | null;
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
       body_html = COALESCE($9, body_html),
       auto_dispatch = COALESCE($10, auto_dispatch),
       scheduled_at = COALESCE($11, scheduled_at),
       batch_size = COALESCE($12, batch_size),
       per_hour = COALESCE($13, per_hour)
     WHERE id = $1
     RETURNING ${CAMPAIGN_COLUMNS}`,
    [
      id, patch.name ?? null, patch.tags ?? null, patch.channels ?? null, patch.status ?? null,
      patch.subject ?? null, patch.bodyType ?? null, patch.bodyText ?? null, patch.bodyHtml ?? null,
      patch.autoDispatch ?? null, patch.scheduledAt ?? null, patch.batchSize ?? null, patch.perHour ?? null,
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

/**
 * Variáveis de personalização suportadas no corpo e assunto (§6.3). Cobrem os
 * dados do contato/lead relacionados; campos personalizados são adicionados
 * dinamicamente com o prefixo `campo_` (ex.: `{{campo_escola_dos_filhos}}`).
 */
export const TEMPLATE_VARS = [
  "nome_lead",
  "primeiro_nome",
  "empresa_lead",
  "email_lead",
  "telefone_lead",
  "vendedor",
  "produto",
] as const;

/** Catálogo de variáveis fixas para a UI (rótulo amigável). */
export const TEMPLATE_VAR_CATALOG: { token: string; label: string }[] = [
  { token: "nome_lead", label: "Nome do contato" },
  { token: "primeiro_nome", label: "Primeiro nome" },
  { token: "empresa_lead", label: "Empresa" },
  { token: "email_lead", label: "E-mail" },
  { token: "telefone_lead", label: "Telefone" },
  { token: "vendedor", label: "Vendedor" },
  { token: "produto", label: "Produto" },
];

/**
 * Substitui as variáveis `{{var}}` do texto pelos valores fornecidos. Variáveis
 * sem valor são substituídas por string vazia. Aceita chaves fixas e chaves de
 * campo personalizado (prefixo `campo_`).
 *
 * @param body - Texto com placeholders (corpo ou assunto).
 * @param values - Mapa de valores por nome de variável.
 * @returns O texto com as variáveis resolvidas.
 */
export function renderTemplate(body: string, values: Record<string, string>): string {
  return body.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => values[name] ?? "");
}

/** Contato resolvido da Base Central para personalização. */
interface AudienceContact {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  company_name: string | null;
}

/**
 * Monta o mapa de variáveis de um contato, incluindo os campos personalizados
 * (com prefixo `campo_<nome>`). Usado para personalizar corpo e assunto.
 *
 * @param client - Cliente PostgreSQL.
 * @param contact - Dados do contato.
 * @param sellerName - Nome do vendedor (autor), opcional.
 * @returns Mapa nome->valor de variáveis.
 */
async function buildTemplateValues(
  client: PoolClient,
  contact: AudienceContact,
  sellerName: string | null,
): Promise<Record<string, string>> {
  const values: Record<string, string> = {
    nome_lead: contact.full_name ?? "",
    primeiro_nome: (contact.full_name ?? "").split(/\s+/)[0] ?? "",
    empresa_lead: contact.company_name ?? "",
    email_lead: contact.email ?? "",
    telefone_lead: contact.phone ?? "",
    vendedor: sellerName ?? "",
    produto: "",
  };

  // Campos personalizados do contato -> {{campo_<nome>}}.
  const cf = await client.query<{ name: string; value: unknown }>(
    `SELECT d.name, v.value
     FROM core.contact_custom_field_values v
     JOIN core.custom_field_defs d ON d.id = v.field_id
     WHERE v.contact_id = $1`,
    [contact.id],
  );
  for (const row of cf.rows) {
    const raw = typeof row.value === "string" ? row.value : JSON.stringify(row.value);
    values[`campo_${row.name}`] = raw;
  }
  return values;
}

/**
 * Carrega os contatos do público (nome/e-mail/telefone/empresa), resolvendo a
 * empresa vinculada quando houver (para a variável `{{empresa_lead}}`).
 *
 * @param client - Cliente PostgreSQL.
 * @param audience - `contact_id` do público.
 * @returns Contatos com dados de personalização.
 */
async function loadAudienceContacts(client: PoolClient, audience: string[]): Promise<AudienceContact[]> {
  const { rows } = await client.query<AudienceContact>(
    `SELECT c.id, c.full_name, c.email, c.phone,
            comp.legal_name AS company_name
     FROM core.contacts c
     LEFT JOIN core.contact_company_links l ON l.person_id = c.id
     LEFT JOIN core.contacts comp ON comp.id = l.company_id
     WHERE c.id = ANY($1::uuid[])`,
    [audience],
  );
  // Deduplica por contato (um contato pode ter mais de um vínculo de empresa).
  const seen = new Map<string, AudienceContact>();
  for (const r of rows) if (!seen.has(r.id)) seen.set(r.id, r);
  return [...seen.values()];
}

/** Resolve o nome do vendedor (autor) para a variável `{{vendedor}}`. */
async function resolveSellerName(client: PoolClient, userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const { rows } = await client.query<{ full_name: string }>(
    `SELECT full_name FROM core.users WHERE id = $1`,
    [userId],
  );
  return rows[0]?.full_name ?? null;
}

/**
 * Envia o conteúdo de uma campanha a um contato pelo canal indicado, com as
 * variáveis do corpo e do assunto resolvidas. Lança em caso de falha.
 *
 * @param client - Cliente PostgreSQL.
 * @param campaign - Campanha.
 * @param channel - Canal.
 * @param contact - Contato destino.
 * @param sellerName - Nome do vendedor.
 * @param actorUserId - Autor (dono do canal de WhatsApp).
 */
async function sendToContact(
  client: PoolClient,
  campaign: Campaign,
  channel: CampaignChannel,
  contact: AudienceContact,
  sellerName: string | null,
  actorUserId: string | null,
): Promise<void> {
  const values = await buildTemplateValues(client, contact, sellerName);
  const text = renderTemplate(campaign.body_text ?? "", values);

  if (channel === "email") {
    if (!contact.email) throw new Error("sem e-mail");
    const subject = renderTemplate(campaign.subject ?? campaign.name, values);
    await sendEmail(client, {
      to: contact.email,
      subject,
      ...(campaign.body_type === "html" && campaign.body_html
        ? { html: renderTemplate(campaign.body_html, values) }
        : { text }),
    });
  } else if (channel === "sms") {
    if (!contact.phone) throw new Error("sem telefone");
    await sendSms(client, contact.phone, text);
  } else {
    // WhatsApp: usa o canal do autor da campanha (created_by/actor).
    if (!contact.phone) throw new Error("sem telefone");
    if (!actorUserId) throw new Error("sem usuário dono do canal de WhatsApp");
    await sendWhatsapp(client, actorUserId, contact.phone, text);
  }
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

  if (campaign && audience.length > 0) {
    const contacts = await loadAudienceContacts(client, audience);
    const sellerName = await resolveSellerName(client, actorUserId);
    for (const contact of contacts) {
      try {
        await sendToContact(client, campaign, channel, contact, sellerName, actorUserId);
        delivered += 1;
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

/**
 * Enfileira o público de uma campanha para disparo automático controlado.
 * Resolve os contatos-alvo pelas etiquetas, insere na fila de destinatários e
 * marca a campanha como `queued`. Idempotente por (campaign_id, contact_id).
 *
 * @param client - Cliente PostgreSQL.
 * @param campaignId - `id` da campanha.
 * @param actorUserId - Autor.
 * @returns Quantidade de destinatários enfileirados.
 */
export async function enqueueCampaign(
  client: PoolClient,
  campaignId: string,
  actorUserId: string | null = null,
): Promise<number> {
  const { rows } = await client.query<{ tags: string[] }>(
    `SELECT tags FROM mod_crm.campaigns WHERE id = $1`,
    [campaignId],
  );
  const campaign = rows[0];
  if (!campaign) return 0;

  // Mapeia etiquetas -> categorias e resolve o público na Base Central.
  const cats = await client.query<{ id: string }>(
    `SELECT id FROM core.contact_categories WHERE name = ANY($1::citext[])`,
    [campaign.tags],
  );
  const categoryIds = cats.rows.map((r) => r.id);
  const audience = categoryIds.length > 0 ? await evaluateSegment(client, { categories: categoryIds }) : [];

  for (const contactId of audience) {
    await client.query(
      `INSERT INTO mod_crm.campaign_recipients (campaign_id, contact_id)
       VALUES ($1, $2) ON CONFLICT (campaign_id, contact_id) DO NOTHING`,
      [campaignId, contactId],
    );
  }

  await client.query(
    `UPDATE mod_crm.campaigns
     SET dispatch_status = 'queued', sent_count = 0, window_started_at = NULL, window_sent_count = 0
     WHERE id = $1`,
    [campaignId],
  );

  await auditLog(client, {
    userId: actorUserId, module: "crm", action: "CRM_CAMPANHA_AGENDADA",
    payloadAfter: { campaign_id: campaignId, audience: audience.length },
  });

  return audience.length;
}

/**
 * Processa um ciclo de disparo automático de uma campanha: envia até
 * `batch_size` destinatários pendentes por ciclo, respeitando o teto `per_hour`
 * (janela deslizante de 1 hora). Atualiza contadores e conclui a campanha
 * quando não há mais pendentes. Não lança: falhas por destinatário são
 * registradas na fila.
 *
 * @param client - Cliente PostgreSQL.
 * @param campaignId - `id` da campanha.
 * @param now - Instante atual (injetável para teste).
 * @returns Quantos foram enviados neste ciclo e se a campanha concluiu.
 */
export async function processCampaignBatch(
  client: PoolClient,
  campaignId: string,
  now: Date = new Date(),
): Promise<{ sent: number; done: boolean }> {
  const { rows } = await client.query<
    Campaign & {
      created_by: string | null;
      window_started_at: Date | null;
      window_sent_count: number;
    }
  >(
    `SELECT ${CAMPAIGN_COLUMNS}, created_by, window_started_at, window_sent_count
     FROM mod_crm.campaigns WHERE id = $1`,
    [campaignId],
  );
  const campaign = rows[0];
  if (!campaign) return { sent: 0, done: true };

  // Ainda não chegou a hora agendada.
  if (campaign.scheduled_at && new Date(campaign.scheduled_at).getTime() > now.getTime()) {
    return { sent: 0, done: false };
  }

  // Reinicia a janela de 1h se expirou.
  let windowStart = campaign.window_started_at ? new Date(campaign.window_started_at) : null;
  let windowSent = campaign.window_sent_count;
  if (!windowStart || now.getTime() - windowStart.getTime() >= 3_600_000) {
    windowStart = now;
    windowSent = 0;
  }

  // Limite deste ciclo: batch_size, e o que resta do teto por hora.
  let limit = campaign.batch_size;
  if (campaign.per_hour != null) {
    const remaining = Math.max(0, campaign.per_hour - windowSent);
    limit = Math.min(limit, remaining);
  }

  if (limit <= 0) {
    // Teto por hora atingido: persiste a janela e aguarda o próximo ciclo.
    await client.query(
      `UPDATE mod_crm.campaigns SET window_started_at = $2, window_sent_count = $3, dispatch_status = 'running' WHERE id = $1`,
      [campaignId, windowStart, windowSent],
    );
    return { sent: 0, done: false };
  }

  const pending = await client.query<{ contact_id: string }>(
    `SELECT contact_id FROM mod_crm.campaign_recipients
     WHERE campaign_id = $1 AND status = 'pending'
     ORDER BY contact_id
     LIMIT $2`,
    [campaignId, limit],
  );

  if (pending.rows.length === 0) {
    await client.query(
      `UPDATE mod_crm.campaigns SET dispatch_status = 'done', last_dispatched_at = $2 WHERE id = $1`,
      [campaignId, now],
    );
    return { sent: 0, done: true };
  }

  const contactIds = pending.rows.map((r) => r.contact_id);
  const contacts = await loadAudienceContacts(client, contactIds);
  const byId = new Map(contacts.map((c) => [c.id, c]));
  const sellerName = await resolveSellerName(client, campaign.created_by);
  const channels = (campaign.channels as CampaignChannel[]).length > 0
    ? (campaign.channels as CampaignChannel[])
    : (["email"] as CampaignChannel[]);

  let sent = 0;
  for (const contactId of contactIds) {
    const contact = byId.get(contactId);
    if (!contact) {
      await client.query(
        `UPDATE mod_crm.campaign_recipients SET status = 'failed', error = 'contato não encontrado' WHERE campaign_id = $1 AND contact_id = $2`,
        [campaignId, contactId],
      );
      continue;
    }
    try {
      // Envia por todos os canais selecionados da campanha.
      for (const channel of channels) {
        await sendToContact(client, campaign, channel, contact, sellerName, campaign.created_by);
      }
      await client.query(
        `UPDATE mod_crm.campaign_recipients SET status = 'sent', sent_at = $3 WHERE campaign_id = $1 AND contact_id = $2`,
        [campaignId, contactId, now],
      );
      sent += 1;
    } catch (e) {
      await client.query(
        `UPDATE mod_crm.campaign_recipients SET status = 'failed', error = $3 WHERE campaign_id = $1 AND contact_id = $2`,
        [campaignId, contactId, e instanceof Error ? e.message : String(e)],
      );
    }
  }

  await client.query(
    `UPDATE mod_crm.campaigns
     SET dispatch_status = 'running', sent_count = sent_count + $2,
         window_started_at = $3, window_sent_count = $4, last_dispatched_at = $5
     WHERE id = $1`,
    [campaignId, sent, windowStart, windowSent + sent, now],
  );

  return { sent, done: false };
}

/**
 * Lista as campanhas com disparo automático em andamento (queued/running) cujo
 * horário agendado já chegou. Usado pelo worker de campanhas.
 *
 * @param client - Cliente PostgreSQL.
 * @param now - Instante atual.
 * @returns `id` das campanhas a processar.
 */
export async function listDueCampaigns(client: PoolClient, now: Date = new Date()): Promise<string[]> {
  const { rows } = await client.query<{ id: string }>(
    `SELECT id FROM mod_crm.campaigns
     WHERE auto_dispatch = true
       AND dispatch_status IN ('queued', 'running')
       AND (scheduled_at IS NULL OR scheduled_at <= $1)
     ORDER BY scheduled_at NULLS FIRST`,
    [now],
  );
  return rows.map((r) => r.id);
}
