/**
 * @file api-key-service.ts
 * @module core/iam
 *
 * Chaves de API para integrações externas. Uma chave funciona como um "usuário
 * de sistema": autentica requisições e é autorizada por namespaces RBAC próprios
 * (core.api_key_permissions). O segredo em claro é retornado apenas na criação;
 * o banco guarda somente seu hash SHA-256 (mesmo princípio das sessões).
 */

import type { PoolClient } from "pg";
import { randomBytes, createHash } from "node:crypto";
import { DomainError, ErrorCode } from "../errors.js";

/** Prefixo humano das chaves de API do HUB Central. */
const KEY_PREFIX = "hck_";
/** Número de bytes aleatórios do segredo (256 bits). */
const KEY_BYTES = 32;
/** Quantidade de caracteres do segredo guardados como identificação (não secreto). */
const DISPLAY_PREFIX_LEN = KEY_PREFIX.length + 8;

/** Chave de API como exposta na administração (sem o segredo). */
export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  status: "active" | "revoked";
  created_by: string | null;
  last_used_at: Date | null;
  created_at: Date;
  revoked_at: Date | null;
}

/** Chave de API com suas permissões concedidas. */
export interface ApiKeyWithPermissions extends ApiKey {
  permissions: string[];
}

/** Calcula o hash SHA-256 (hex) de um segredo de chave. */
function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

const KEY_COLUMNS =
  "id, name, prefix, status, created_by, last_used_at, created_at, revoked_at";

/**
 * Cria uma chave de API e retorna o segredo em claro (mostrado UMA única vez).
 * O banco guarda apenas o hash e um prefixo de identificação.
 *
 * @param client - Cliente PostgreSQL.
 * @param name - Rótulo da chave.
 * @param createdBy - `user_id` do criador (ou null).
 * @returns A chave criada e o `secret` em claro (guardar com segurança).
 * @throws {DomainError} `API_KEY_INVALID_NAME` se o nome for vazio.
 */
export async function createApiKey(
  client: PoolClient,
  name: string,
  createdBy: string | null,
): Promise<{ key: ApiKey; secret: string }> {
  const trimmed = name.trim();
  if (trimmed === "") {
    throw new DomainError(ErrorCode.API_KEY_INVALID_NAME, "Informe um nome para a chave de API.", {});
  }
  const secret = `${KEY_PREFIX}${randomBytes(KEY_BYTES).toString("hex")}`;
  const prefix = secret.slice(0, DISPLAY_PREFIX_LEN);
  const { rows } = await client.query<ApiKey>(
    `INSERT INTO core.api_keys (name, prefix, key_hash, created_by)
     VALUES ($1, $2, $3, $4)
     RETURNING ${KEY_COLUMNS}`,
    [trimmed, prefix, hashSecret(secret), createdBy],
  );
  return { key: rows[0] as ApiKey, secret };
}

/**
 * Lista as chaves de API com suas permissões, mais recentes primeiro.
 *
 * @param client - Cliente PostgreSQL.
 * @returns As chaves cadastradas (sem segredos).
 */
export async function listApiKeys(client: PoolClient): Promise<ApiKeyWithPermissions[]> {
  const { rows } = await client.query<ApiKey>(
    `SELECT ${KEY_COLUMNS} FROM core.api_keys ORDER BY created_at DESC`,
  );
  const { rows: perms } = await client.query<{ api_key_id: string; namespace: string }>(
    `SELECT api_key_id, namespace FROM core.api_key_permissions ORDER BY namespace`,
  );
  const byKey = new Map<string, string[]>();
  for (const p of perms) {
    if (!byKey.has(p.api_key_id)) byKey.set(p.api_key_id, []);
    byKey.get(p.api_key_id)!.push(p.namespace);
  }
  return rows.map((k) => ({ ...k, permissions: byKey.get(k.id) ?? [] }));
}

/**
 * Revoga uma chave de API (não pode mais autenticar). Idempotente.
 *
 * @param client - Cliente PostgreSQL.
 * @param keyId - `id` da chave.
 * @returns `true` se uma chave ativa foi revogada.
 */
export async function revokeApiKey(client: PoolClient, keyId: string): Promise<boolean> {
  const { rowCount } = await client.query(
    `UPDATE core.api_keys SET status = 'revoked', revoked_at = now()
     WHERE id = $1 AND status = 'active'`,
    [keyId],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * Substitui o conjunto de permissões (namespaces) de uma chave de API.
 *
 * @param client - Cliente PostgreSQL.
 * @param keyId - `id` da chave.
 * @param namespaces - Conjunto desejado de namespaces.
 * @throws {DomainError} `API_KEY_NOT_FOUND` se a chave não existe.
 */
export async function setApiKeyPermissions(
  client: PoolClient,
  keyId: string,
  namespaces: readonly string[],
): Promise<void> {
  const exists = await client.query<{ id: string }>(`SELECT id FROM core.api_keys WHERE id = $1`, [keyId]);
  if (!exists.rows[0]) {
    throw new DomainError(ErrorCode.API_KEY_NOT_FOUND, "Chave de API não encontrada.", { api_key_id: keyId });
  }
  await client.query(`DELETE FROM core.api_key_permissions WHERE api_key_id = $1`, [keyId]);
  const unique = Array.from(new Set(namespaces));
  for (const ns of unique) {
    await client.query(
      `INSERT INTO core.api_key_permissions (api_key_id, namespace)
       VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [keyId, ns],
    );
  }
}

/**
 * Resolve o `id` de uma chave de API ativa a partir do segredo em claro,
 * atualizando `last_used_at`. Retorna `null` se o segredo não corresponde a
 * uma chave ativa.
 *
 * @param client - Cliente PostgreSQL.
 * @param secret - Segredo em claro apresentado pelo cliente.
 * @returns O `id` da chave ativa, ou `null`.
 */
export async function resolveApiKey(client: PoolClient, secret: string): Promise<string | null> {
  if (!secret.startsWith(KEY_PREFIX)) return null;
  const { rows } = await client.query<{ id: string }>(
    `UPDATE core.api_keys SET last_used_at = now()
     WHERE key_hash = $1 AND status = 'active'
     RETURNING id`,
    [hashSecret(secret)],
  );
  return rows[0]?.id ?? null;
}

/**
 * Indica se uma chave de API possui um namespace RBAC.
 *
 * @param client - Cliente PostgreSQL.
 * @param keyId - `id` da chave.
 * @param namespace - Namespace exigido.
 * @returns `true` se a chave possui o namespace.
 */
export async function apiKeyHasNamespace(
  client: PoolClient,
  keyId: string,
  namespace: string,
): Promise<boolean> {
  const { rows } = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM core.api_key_permissions WHERE api_key_id = $1 AND namespace = $2
     ) AS exists`,
    [keyId, namespace],
  );
  return rows[0]?.exists ?? false;
}

/**
 * Autoriza uma ação de uma chave de API exigindo o namespace. Ao contrário de
 * usuários, chaves de API NÃO têm bypass de superadmin: só podem o que lhes foi
 * explicitamente concedido.
 *
 * @param client - Cliente PostgreSQL.
 * @param keyId - `id` da chave (ou null se não autenticada por chave).
 * @param namespace - Namespace exigido.
 * @throws {DomainError} `AUTH_UNAUTHORIZED` se `keyId` for nulo.
 * @throws {DomainError} `RBAC_ACCESS_DENIED` se faltar o namespace.
 */
export async function authorizeApiKey(
  client: PoolClient,
  keyId: string | null,
  namespace: string,
): Promise<void> {
  if (!keyId) {
    throw new DomainError(ErrorCode.AUTH_UNAUTHORIZED, "Requisição sem chave de API válida.", {
      required_namespace: namespace,
    });
  }
  if (!(await apiKeyHasNamespace(client, keyId, namespace))) {
    throw new DomainError(ErrorCode.RBAC_ACCESS_DENIED, "A chave de API não tem permissão para esta ação.", {
      required_namespace: namespace,
    });
  }
}
