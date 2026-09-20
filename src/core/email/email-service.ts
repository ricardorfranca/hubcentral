/**
 * @file email-service.ts
 * @module core/email
 *
 * Serviço central de e-mail do HUB Central. Lê a configuração SMTP da Central
 * de Configurações (`core.settings`) e provê verificação de conexão e envio.
 * É a única porta de saída de e-mail — qualquer módulo que precise enviar
 * e-mail usa `sendEmail`.
 */

import type { PoolClient } from "pg";
import nodemailer, { type Transporter } from "nodemailer";
import { DomainError, ErrorCode } from "../errors.js";
import { resolveValue } from "../settings/settings-service.js";

/** Configuração SMTP resolvida da Central de Configurações. */
export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  from: string;
}

/**
 * Lê a configuração SMTP efetiva. Lança se host ou remetente não estiverem
 * configurados.
 *
 * @param client - Cliente PostgreSQL.
 * @returns A configuração SMTP.
 * @throws {DomainError} `SMTP_NOT_CONFIGURED` se faltar host/remetente.
 */
export async function getSmtpConfig(client: PoolClient): Promise<SmtpConfig> {
  const host = (await resolveValue(client, "core.smtp.host", "SMTP_HOST")) ?? "";
  const from = (await resolveValue(client, "core.smtp.from", "SMTP_FROM")) ?? "";
  if (!host || !from) {
    throw new DomainError(ErrorCode.SMTP_NOT_CONFIGURED, "SMTP não configurado (host e remetente são obrigatórios).", {});
  }
  const port = Number((await resolveValue(client, "core.smtp.port", "SMTP_PORT")) ?? "587");
  const secureRaw = (await resolveValue(client, "core.smtp.secure", "SMTP_SECURE")) ?? "false";
  return {
    host,
    port: Number.isFinite(port) ? port : 587,
    secure: secureRaw === "true",
    user: (await resolveValue(client, "core.smtp.user", "SMTP_USER")) ?? "",
    password: (await resolveValue(client, "core.smtp.password", "SMTP_PASSWORD")) ?? "",
    from,
  };
}

/** Cria um transporter nodemailer a partir da configuração. */
function createTransport(cfg: SmtpConfig): Transporter {
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: cfg.user ? { user: cfg.user, pass: cfg.password } : undefined,
  });
}

/**
 * Verifica a conexão/autenticação com o servidor SMTP configurado.
 *
 * @param client - Cliente PostgreSQL.
 * @returns `{ ok: true }` se a conexão foi verificada.
 * @throws {DomainError} `SMTP_NOT_CONFIGURED`/`SMTP_ERROR` conforme o caso.
 */
export async function verifyConnection(client: PoolClient): Promise<{ ok: true }> {
  const cfg = await getSmtpConfig(client);
  const transport = createTransport(cfg);
  try {
    await transport.verify();
    return { ok: true };
  } catch (e) {
    throw new DomainError(ErrorCode.SMTP_ERROR, "Falha ao conectar ao servidor SMTP.", {
      detail: e instanceof Error ? e.message : String(e),
    });
  } finally {
    transport.close();
  }
}

/**
 * Envia um e-mail usando a configuração SMTP do sistema.
 *
 * @param client - Cliente PostgreSQL.
 * @param message - Destinatário, assunto e corpo (texto e/ou HTML).
 * @throws {DomainError} `SMTP_NOT_CONFIGURED`/`SMTP_ERROR` conforme o caso.
 */
export async function sendEmail(
  client: PoolClient,
  message: { to: string; subject: string; text?: string; html?: string },
): Promise<void> {
  const cfg = await getSmtpConfig(client);
  const transport = createTransport(cfg);
  try {
    await transport.sendMail({
      from: cfg.from,
      to: message.to,
      subject: message.subject,
      ...(message.text ? { text: message.text } : {}),
      ...(message.html ? { html: message.html } : {}),
    });
  } catch (e) {
    throw new DomainError(ErrorCode.SMTP_ERROR, "Falha ao enviar e-mail.", {
      detail: e instanceof Error ? e.message : String(e),
    });
  } finally {
    transport.close();
  }
}
