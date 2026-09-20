/**
 * @file settings-service.ts
 * @module core/settings
 *
 * Central de Configurações do HUB Central. Serviço genérico do núcleo: cada
 * módulo registra suas chaves (namespaced por `modulo.recurso.parametro`) com
 * tipo, rótulo, descrição e default. A resolução do valor efetivo segue a
 * precedência: valor persistido -> default_value -> variável de ambiente.
 */

import type { PoolClient } from "pg";
import { DomainError, ErrorCode } from "../errors.js";
import { log as auditLog } from "../audit/audit-logger.js";

/** Tipo do valor de uma configuração. */
export type SettingType = "int" | "bool" | "string" | "json" | "csv";

/** Configuração como persistida em `core.settings`. */
export interface Setting {
  key: string;
  module: string;
  value: string | null;
  value_type: SettingType;
  label: string;
  description: string | null;
  default_value: string | null;
  updated_at: Date;
  updated_by: string | null;
}

const COLUMNS =
  "key, module, value, value_type, label, description, default_value, updated_at, updated_by";

/**
 * Registra (declara) uma chave de configuração. Idempotente: se a chave já
 * existe, atualiza apenas os metadados de exibição (module/tipo/label/descrição/
 * default), preservando o `value` já persistido. Usado no seed das migrations.
 *
 * @param client - Cliente PostgreSQL.
 * @param def - Definição da chave.
 */
export async function registerSetting(
  client: PoolClient,
  def: {
    key: string;
    module: string;
    valueType: SettingType;
    label: string;
    description?: string | undefined;
    defaultValue?: string | undefined;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO core.settings (key, module, value, value_type, label, description, default_value)
     VALUES ($1, $2, NULL, $3, $4, $5, $6)
     ON CONFLICT (key) DO UPDATE SET
       module = EXCLUDED.module,
       value_type = EXCLUDED.value_type,
       label = EXCLUDED.label,
       description = EXCLUDED.description,
       default_value = EXCLUDED.default_value`,
    [def.key, def.module, def.valueType, def.label, def.description ?? null, def.defaultValue ?? null],
  );
}

/**
 * Retorna a configuração persistida de uma chave, ou `null` se não registrada.
 *
 * @param client - Cliente PostgreSQL.
 * @param key - Chave da configuração.
 * @returns A configuração, ou `null`.
 */
export async function getSetting(client: PoolClient, key: string): Promise<Setting | null> {
  const { rows } = await client.query<Setting>(
    `SELECT ${COLUMNS} FROM core.settings WHERE key = $1`,
    [key],
  );
  return rows[0] ?? null;
}

/**
 * Resolve o valor bruto (string) efetivo de uma chave, seguindo a precedência
 * valor persistido -> default_value -> variável de ambiente (`envKey`).
 *
 * @param client - Cliente PostgreSQL.
 * @param key - Chave da configuração.
 * @param envKey - Nome da variável de ambiente de fallback (opcional).
 * @returns O valor bruto, ou `null` se nenhum nível fornecer valor.
 */
export async function resolveValue(
  client: PoolClient,
  key: string,
  envKey?: string,
): Promise<string | null> {
  const setting = await getSetting(client, key);
  if (setting?.value != null && setting.value !== "") return setting.value;
  if (setting?.default_value != null && setting.default_value !== "") return setting.default_value;
  if (envKey && process.env[envKey]) return process.env[envKey] as string;
  return null;
}

/**
 * Resolve o valor de uma chave como inteiro (com fallback e valor padrão).
 *
 * @param client - Cliente PostgreSQL.
 * @param key - Chave da configuração.
 * @param fallback - Valor usado se nada for resolvido ou o parse falhar.
 * @param envKey - Variável de ambiente de fallback (opcional).
 * @returns O inteiro resolvido.
 */
export async function getSettingInt(
  client: PoolClient,
  key: string,
  fallback: number,
  envKey?: string,
): Promise<number> {
  const raw = await resolveValue(client, key, envKey);
  const n = raw == null ? NaN : Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Resolve o valor de uma chave como lista (CSV), normalizada em minúsculas e
 * sem espaços/vazios.
 *
 * @param client - Cliente PostgreSQL.
 * @param key - Chave da configuração.
 * @param fallback - Lista usada se nada for resolvido.
 * @param envKey - Variável de ambiente de fallback (opcional).
 * @returns A lista resolvida.
 */
export async function getSettingList(
  client: PoolClient,
  key: string,
  fallback: string[],
  envKey?: string,
): Promise<string[]> {
  const raw = await resolveValue(client, key, envKey);
  if (raw == null) return fallback;
  const items = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
  return items.length > 0 ? items : fallback;
}

/**
 * Lista as configurações, opcionalmente filtradas por módulo, ordenadas por
 * módulo e chave (para agrupamento na UI).
 *
 * @param client - Cliente PostgreSQL.
 * @param options - `module` para filtrar por origem.
 * @returns As configurações registradas.
 */
export async function listSettings(
  client: PoolClient,
  options: { module?: string } = {},
): Promise<Setting[]> {
  const { rows } = await client.query<Setting>(
    `SELECT ${COLUMNS} FROM core.settings
     ${options.module ? "WHERE module = $1" : ""}
     ORDER BY module, key`,
    options.module ? [options.module] : [],
  );
  return rows;
}

/**
 * Persiste o valor de uma chave e grava auditoria. A chave deve estar
 * registrada previamente (via {@link registerSetting}).
 *
 * @param client - Cliente PostgreSQL.
 * @param key - Chave da configuração.
 * @param value - Novo valor (string serializada), ou `null` para voltar ao default.
 * @param actorUserId - Autor da alteração.
 * @returns A configuração atualizada.
 * @throws {DomainError} `SETTING_NOT_FOUND` se a chave não está registrada.
 */
export async function setSetting(
  client: PoolClient,
  key: string,
  value: string | null,
  actorUserId: string | null = null,
): Promise<Setting> {
  const before = await getSetting(client, key);
  if (!before) {
    throw new DomainError(ErrorCode.SETTING_NOT_FOUND, "Configuração não encontrada.", { key });
  }
  const { rows } = await client.query<Setting>(
    `UPDATE core.settings SET value = $2, updated_at = now(), updated_by = $3
     WHERE key = $1 RETURNING ${COLUMNS}`,
    [key, value, actorUserId],
  );
  const after = rows[0] as Setting;
  await auditLog(client, {
    userId: actorUserId,
    module: "core",
    action: "CONFIG_ALTERADA",
    payloadBefore: { key, value: before.value },
    payloadAfter: { key, value: after.value },
  });
  return after;
}
