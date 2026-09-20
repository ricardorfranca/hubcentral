/**
 * @file module-registry.ts
 * @module core/modules
 *
 * ModuleRegistry — valida e registra módulos satélites no HUB Central (Req 8, 10).
 * Valida o manifesto (campos obrigatórios, module_id único, schema mod_[nome],
 * requires_core_tables existentes, versão SemVer) e os namespaces RBAC.
 */

import type { PoolClient } from "pg";
import { DomainError, ErrorCode } from "../errors.js";
import { log as auditLog } from "../audit/audit-logger.js";

/** Manifesto declarado por um módulo ao se registrar (Req 8.1). */
export interface ModuleManifest {
  module_id: string;
  display_name: string;
  schema: string;
  version: string;
  config_panel: boolean;
  has_export: boolean;
  has_import: boolean;
  emits_events: boolean;
  requires_core_tables: string[];
}

/** Campos obrigatórios do manifesto (Req 8.1, 8.2). */
const REQUIRED_MANIFEST_FIELDS: readonly (keyof ModuleManifest)[] = [
  "module_id",
  "display_name",
  "schema",
  "version",
  "config_panel",
  "has_export",
  "has_import",
  "emits_events",
  "requires_core_tables",
];

/** Padrão de schema de módulo (Req 8.4). */
export const MODULE_SCHEMA_PATTERN = /^mod_[a-z0-9_]+$/;
/** Padrão SemVer MAJOR.MINOR.PATCH (Req 8.8). */
export const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/;
/** Padrão de namespace RBAC [modulo]:[recurso]:[acao] (Req 10.1, 10.2). */
export const RBAC_NAMESPACE_PATTERN = /^[a-z0-9_]+:[a-z0-9_]+:[a-z0-9_]+$/;

/** Resultado de validação: ok ou erro de domínio associado. */
export interface ValidationResult {
  ok: boolean;
  error?: DomainError;
}

/**
 * Valida o formato estático de um manifesto (sem tocar o banco): campos
 * obrigatórios presentes (8.2), schema no padrão (8.4) e versão SemVer (8.8).
 *
 * @param manifest - Manifesto candidato (formato desconhecido).
 * @returns Resultado da validação.
 */
export function validateManifestShape(manifest: Partial<ModuleManifest>): ValidationResult {
  for (const field of REQUIRED_MANIFEST_FIELDS) {
    const value = manifest[field];
    if (value === undefined || value === null || value === "") {
      return {
        ok: false,
        error: new DomainError(
          ErrorCode.MANIFEST_MISSING_FIELD,
          `Campo obrigatório do manifesto ausente: ${String(field)}.`,
          { field },
        ),
      };
    }
  }

  if (!MODULE_SCHEMA_PATTERN.test(manifest.schema as string)) {
    return {
      ok: false,
      error: new DomainError(
        ErrorCode.MANIFEST_INVALID_SCHEMA,
        "O schema do módulo deve seguir o padrão mod_[nome].",
        { schema: manifest.schema },
      ),
    };
  }

  if (!SEMVER_PATTERN.test(manifest.version as string)) {
    return {
      ok: false,
      error: new DomainError(
        ErrorCode.MANIFEST_INVALID_VERSION,
        "A versão deve estar em SemVer MAJOR.MINOR.PATCH.",
        { version: manifest.version },
      ),
    };
  }

  return { ok: true };
}

/**
 * Valida uma lista de namespaces RBAC quanto ao formato (Req 10.2).
 *
 * @param namespaces - Namespaces declarados.
 * @returns Resultado da validação; em erro, aponta o namespace inválido.
 */
export function validateNamespaces(namespaces: readonly string[]): ValidationResult {
  for (const ns of namespaces) {
    if (!RBAC_NAMESPACE_PATTERN.test(ns)) {
      return {
        ok: false,
        error: new DomainError(
          ErrorCode.RBAC_INVALID_NAMESPACE,
          `Namespace RBAC inválido: '${ns}'. Use [modulo]:[recurso]:[acao].`,
          { namespace: ns },
        ),
      };
    }
  }
  return { ok: true };
}

/**
 * Registra um módulo, validando manifesto e namespaces e verificando as
 * dependências de tabelas de núcleo (Req 8.5, 8.6). Grava auditoria (Req 8.7).
 *
 * @param client - Cliente PostgreSQL (em transação).
 * @param manifest - Manifesto do módulo.
 * @param namespaces - Namespaces RBAC declarados.
 * @param actorUserId - Autor do registro, ou `null` para SYSTEM.
 * @throws {DomainError} Diversos códigos de validação (ver ErrorCode).
 */
export async function registerModule(
  client: PoolClient,
  manifest: Partial<ModuleManifest>,
  namespaces: readonly string[] = [],
  actorUserId: string | null = null,
): Promise<void> {
  const shape = validateManifestShape(manifest);
  if (!shape.ok) {
    throw shape.error!;
  }
  const ns = validateNamespaces(namespaces);
  if (!ns.ok) {
    throw ns.error!;
  }

  const full = manifest as ModuleManifest;

  // module_id único (Req 8.3).
  const existing = await client.query<{ module_id: string }>(
    `SELECT module_id FROM core.registered_modules WHERE module_id = $1`,
    [full.module_id],
  );
  if (existing.rows[0]) {
    throw new DomainError(
      ErrorCode.MODULE_ALREADY_REGISTERED,
      `O módulo '${full.module_id}' já está registrado.`,
      { module_id: full.module_id },
    );
  }

  // requires_core_tables existem (Req 8.5, 8.6).
  for (const qualified of full.requires_core_tables) {
    const [schema, table] = qualified.includes(".")
      ? qualified.split(".", 2)
      : ["core", qualified];
    const found = await client.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables
         WHERE table_schema = $1 AND table_name = $2
       ) AS exists`,
      [schema, table],
    );
    if (!found.rows[0]?.exists) {
      throw new DomainError(
        ErrorCode.MANIFEST_MISSING_CORE_TABLE,
        `Tabela de núcleo requerida não existe: ${qualified}.`,
        { missing_table: qualified },
      );
    }
  }

  await client.query(
    `INSERT INTO core.registered_modules (module_id, manifest, version)
     VALUES ($1, $2::jsonb, $3)`,
    [full.module_id, JSON.stringify(full), full.version],
  );

  // Auditoria do registro bem-sucedido (Req 8.7).
  await auditLog(client, {
    userId: actorUserId,
    module: "core",
    action: "MODULO_REGISTRADO",
    payloadAfter: { module_id: full.module_id, version: full.version },
  });
}
