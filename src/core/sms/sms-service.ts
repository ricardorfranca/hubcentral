/**
 * @file sms-service.ts
 * @module core/sms
 *
 * Serviço central de SMS do HUB Central. Suporta dois gateways, selecionáveis
 * na Central de Configurações: Clickatell (API HTTP na nuvem) e GoIP (gateway
 * GSM local via HTTP). É a única porta de saída de SMS — módulos usam `sendSms`.
 * Degrada com elegância: sem configuração/rede, lança erro de domínio claro.
 */

import type { PoolClient } from "pg";
import { DomainError, ErrorCode } from "../errors.js";
import { resolveValue } from "../settings/settings-service.js";

/** Provedor de SMS configurado. */
export type SmsProvider = "clickatell" | "goip";

/** Normaliza um telefone para o formato E.164 sem o '+' (dígitos), assumindo BR. */
function toDigits(phone: string): string {
  let d = phone.replace(/\D/g, "");
  if (d.length <= 11) d = `55${d}`; // adiciona DDI Brasil se veio só nacional
  return d;
}

/**
 * Lê o provedor de SMS configurado.
 *
 * @param client - Cliente PostgreSQL.
 * @returns O provedor (`clickatell` ou `goip`).
 */
export async function getSmsProvider(client: PoolClient): Promise<SmsProvider> {
  const p = (await resolveValue(client, "core.sms.provider", "SMS_PROVIDER")) ?? "clickatell";
  return p === "goip" ? "goip" : "clickatell";
}

/**
 * Envia um SMS pelo gateway configurado.
 *
 * @param client - Cliente PostgreSQL.
 * @param to - Telefone destino (E.164 ou nacional; normalizado para BR).
 * @param text - Texto da mensagem.
 * @throws {DomainError} `SMS_NOT_CONFIGURED`/`SMS_ERROR` conforme o caso.
 */
export async function sendSms(client: PoolClient, to: string, text: string): Promise<void> {
  const provider = await getSmsProvider(client);
  const phone = toDigits(to);
  if (provider === "clickatell") {
    await sendViaClickatell(client, phone, text);
  } else {
    await sendViaGoip(client, phone, text);
  }
}

/**
 * Testa a configuração do gateway atual. Para o Clickatell, valida a presença
 * da chave; para o GoIP, testa alcançar a URL base. Não envia SMS real.
 *
 * @param client - Cliente PostgreSQL.
 * @returns `{ ok: true, provider }` se a configuração parece válida.
 * @throws {DomainError} `SMS_NOT_CONFIGURED`/`SMS_ERROR` conforme o caso.
 */
export async function verifySms(client: PoolClient): Promise<{ ok: true; provider: SmsProvider }> {
  const provider = await getSmsProvider(client);
  if (provider === "clickatell") {
    const key = await resolveValue(client, "core.sms.clickatell.api_key", "SMS_CLICKATELL_KEY");
    if (!key) throw new DomainError(ErrorCode.SMS_NOT_CONFIGURED, "Clickatell sem API Key configurada.", {});
    return { ok: true, provider };
  }
  const baseUrl = await resolveValue(client, "core.sms.goip.base_url", "SMS_GOIP_URL");
  if (!baseUrl) throw new DomainError(ErrorCode.SMS_NOT_CONFIGURED, "GoIP sem URL base configurada.", {});
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 5000);
    await fetch(baseUrl, { signal: controller.signal });
    clearTimeout(t);
    return { ok: true, provider };
  } catch (e) {
    throw new DomainError(ErrorCode.SMS_ERROR, "Não foi possível alcançar o gateway GoIP.", {
      detail: e instanceof Error ? e.message : String(e),
    });
  }
}

/** Envio via Clickatell (API HTTP REST one-way). */
async function sendViaClickatell(client: PoolClient, phone: string, text: string): Promise<void> {
  const apiKey = await resolveValue(client, "core.sms.clickatell.api_key", "SMS_CLICKATELL_KEY");
  if (!apiKey) throw new DomainError(ErrorCode.SMS_NOT_CONFIGURED, "Clickatell sem API Key configurada.", {});
  const from = await resolveValue(client, "core.sms.clickatell.from", "SMS_CLICKATELL_FROM");

  const body: Record<string, unknown> = { to: [phone], content: text };
  if (from) body.from = from;

  try {
    const res = await fetch("https://platform.clickatell.com/messages", {
      method: "POST",
      headers: { Authorization: apiKey, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new DomainError(ErrorCode.SMS_ERROR, `Clickatell respondeu ${res.status}.`, {});
    }
  } catch (e) {
    if (e instanceof DomainError) throw e;
    throw new DomainError(ErrorCode.SMS_ERROR, "Falha ao enviar SMS via Clickatell.", {
      detail: e instanceof Error ? e.message : String(e),
    });
  }
}

/** Envio via GoIP (gateway GSM local, API HTTP de envio). */
async function sendViaGoip(client: PoolClient, phone: string, text: string): Promise<void> {
  const baseUrl = await resolveValue(client, "core.sms.goip.base_url", "SMS_GOIP_URL");
  if (!baseUrl) throw new DomainError(ErrorCode.SMS_NOT_CONFIGURED, "GoIP sem URL base configurada.", {});
  const username = (await resolveValue(client, "core.sms.goip.username", "SMS_GOIP_USER")) ?? "";
  const password = (await resolveValue(client, "core.sms.goip.password", "SMS_GOIP_PASS")) ?? "";
  const line = (await resolveValue(client, "core.sms.goip.line", "SMS_GOIP_LINE")) ?? "1";

  // GoIP expõe um endpoint HTTP de envio; parâmetros variam por firmware. Usamos
  // o formato comum de sendsms com autenticação básica por querystring.
  const url = new URL("/default/en_US/send.html", baseUrl);
  url.searchParams.set("u", username);
  url.searchParams.set("p", password);
  url.searchParams.set("l", line);
  url.searchParams.set("n", phone);
  url.searchParams.set("m", text);

  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url.toString(), { signal: controller.signal });
    clearTimeout(t);
    if (!res.ok) {
      throw new DomainError(ErrorCode.SMS_ERROR, `GoIP respondeu ${res.status}.`, {});
    }
  } catch (e) {
    if (e instanceof DomainError) throw e;
    throw new DomainError(ErrorCode.SMS_ERROR, "Falha ao enviar SMS via GoIP.", {
      detail: e instanceof Error ? e.message : String(e),
    });
  }
}
