/**
 * @file telephony-service.ts
 * @module core/telephony
 *
 * Discagem telefônica via PABX remoto. O sistema executa um comando `curl`
 * configurável (Central de Configurações) com as variáveis do sistema
 * substituídas, solicitando ao PABX que origine/retorne a chamada a partir do
 * ramal do usuário. O template é definido pelo administrador; os valores são
 * escapados para shell para evitar injeção de comando.
 */

import type { PoolClient } from "pg";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { DomainError, ErrorCode } from "../errors.js";
import { resolveValue } from "../settings/settings-service.js";

const execFileAsync = promisify(execFile);

/** Variáveis suportadas no template de discagem. */
export interface DialVars {
  /** Ramal do usuário no PABX. */
  ramal: string;
  /** Telefone destino como cadastrado (dígitos e símbolos preservados). */
  telefone: string;
  /** Telefone destino normalizado em E.164 sem '+'. */
  telefone_e164: string;
  /** Nome do usuário que solicita a chamada. */
  usuario: string;
  /** Nome do contato de destino. */
  contato: string;
}

/** Normaliza um telefone para dígitos E.164 sem '+', assumindo Brasil. */
function toE164(phone: string): string {
  let d = phone.replace(/\D/g, "");
  if (d.length <= 11) d = `55${d}`;
  return d;
}

/**
 * Escapa um valor para uso seguro dentro de aspas simples no shell POSIX.
 * Impede injeção de comando ao interpolar dados dinâmicos no template.
 *
 * @param value - Valor bruto.
 * @returns Valor escapado, entre aspas simples.
 */
/**
 * Sanitiza um valor para interpolação segura em um template de comando shell.
 * Como o template é livre (o valor pode cair dentro de aspas simples, duplas ou
 * de uma querystring), não há escape universal confiável; por isso removemos
 * qualquer caractere com significado no shell, mantendo apenas o conjunto seguro
 * necessário para telefones, ramais e nomes (alfanuméricos, espaço e `+-_.@`).
 *
 * @param value - Valor bruto.
 * @returns Valor contendo apenas caracteres seguros.
 */
function sanitizeShellValue(value: string): string {
  return value.replace(/[^A-Za-z0-9 +\-_.@]/g, "");
}

/**
 * Substitui as variáveis `{{var}}` do template pelos valores fornecidos,
 * sanitizados para uso seguro no shell. Variáveis desconhecidas viram string
 * vazia.
 *
 * @param template - Template de comando com placeholders.
 * @param vars - Valores das variáveis.
 * @returns O comando com as variáveis resolvidas e sanitizadas.
 */
export function renderDialCommand(template: string, vars: DialVars): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => {
    const key = name as keyof DialVars;
    const raw = key in vars ? vars[key] : "";
    return sanitizeShellValue(String(raw ?? ""));
  });
}

/**
 * Solicita uma chamada ao PABX remoto executando o template de curl configurado.
 * Requer que a discagem esteja habilitada, um template válido e o ramal do
 * usuário. O comando roda com shell (`/bin/sh -c`) para suportar templates
 * completos de curl; os valores dinâmicos são escapados.
 *
 * @param client - Cliente PostgreSQL.
 * @param vars - Variáveis de discagem já resolvidas (ramal/telefone/etc.).
 * @throws {DomainError} `TELEPHONY_NOT_CONFIGURED` se desabilitado/sem template/sem ramal.
 * @throws {DomainError} `TELEPHONY_ERROR` se o comando falhar.
 */
export async function dial(client: PoolClient, vars: DialVars): Promise<void> {
  const enabled = (await resolveValue(client, "core.telephony.dial.enabled", "TELEPHONY_DIAL_ENABLED")) === "true";
  const template = (await resolveValue(client, "core.telephony.dial.curl_template", "TELEPHONY_DIAL_CURL")) ?? "";

  if (!enabled || !template.trim()) {
    throw new DomainError(
      ErrorCode.TELEPHONY_NOT_CONFIGURED,
      "Discagem por PABX não está habilitada ou o comando de discagem não foi configurado.",
      {},
    );
  }
  if (!vars.ramal.trim()) {
    throw new DomainError(
      ErrorCode.TELEPHONY_NOT_CONFIGURED,
      "O usuário não possui ramal configurado para originar a chamada.",
      {},
    );
  }

  const command = renderDialCommand(template, { ...vars, telefone_e164: toE164(vars.telefone) });
  try {
    // Executa o comando montado. Timeout de guarda de 15s.
    await execFileAsync("/bin/sh", ["-c", command], { timeout: 15000 });
  } catch (e) {
    throw new DomainError(ErrorCode.TELEPHONY_ERROR, "Falha ao solicitar a chamada ao PABX.", {
      detail: e instanceof Error ? e.message : String(e),
    });
  }
}

/** Reexporta o normalizador para uso nas rotas. */
export { toE164 };
