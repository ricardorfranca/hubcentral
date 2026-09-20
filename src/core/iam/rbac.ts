/**
 * @file rbac.ts
 * @module core/iam
 *
 * Autorização RBAC do HUB Central (Req 9, 10). Concede e verifica namespaces
 * `[modulo]:[recurso]:[acao]` atribuídos a usuários, e oferece um guard
 * agnóstico de framework para proteger ações de módulo.
 */

import type { PoolClient } from "pg";
import { DomainError, ErrorCode } from "../errors.js";

/**
 * Concede um namespace RBAC a um usuário (Req 10.5). Idempotente.
 *
 * @param client - Cliente PostgreSQL.
 * @param userId - `user_id` do usuário.
 * @param namespace - Namespace `[modulo]:[recurso]:[acao]`.
 */
export async function grantNamespace(
  client: PoolClient,
  userId: string,
  namespace: string,
): Promise<void> {
  await client.query(
    `INSERT INTO core.user_permissions (user_id, namespace)
     VALUES ($1, $2) ON CONFLICT (user_id, namespace) DO NOTHING`,
    [userId, namespace],
  );
}

/**
 * Lista todos os namespaces RBAC concedidos a um usuário.
 *
 * @param client - Cliente PostgreSQL.
 * @param userId - `user_id` do usuário.
 * @returns Lista de namespaces (possivelmente vazia).
 */
export async function listUserPermissions(
  client: PoolClient,
  userId: string,
): Promise<string[]> {
  const { rows } = await client.query<{ namespace: string }>(
    `SELECT namespace FROM core.user_permissions WHERE user_id = $1 ORDER BY namespace`,
    [userId],
  );
  return rows.map((r) => r.namespace);
}

/**
 * Indica se um usuário possui um namespace RBAC (Req 10.3).
 *
 * @param client - Cliente PostgreSQL.
 * @param userId - `user_id` do usuário.
 * @param namespace - Namespace exigido.
 * @returns `true` se o usuário possui o namespace.
 */
export async function hasNamespace(
  client: PoolClient,
  userId: string,
  namespace: string,
): Promise<boolean> {
  const { rows } = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM core.user_permissions WHERE user_id = $1 AND namespace = $2
     ) AS exists`,
    [userId, namespace],
  );
  return rows[0]?.exists ?? false;
}

/**
 * Autoriza uma ação exigindo que o usuário possua o namespace (Req 10.3, 10.4).
 * Lança se o usuário não estiver autenticado ou não possuir o namespace.
 *
 * @param client - Cliente PostgreSQL.
 * @param userId - `user_id` autenticado, ou `null` se não autenticado.
 * @param namespace - Namespace exigido para a ação.
 * @throws {DomainError} `AUTH_UNAUTHORIZED` se `userId` for nulo (Req 9.4).
 * @throws {DomainError} `RBAC_ACCESS_DENIED` se faltar o namespace (Req 10.4).
 */
export async function authorize(
  client: PoolClient,
  userId: string | null,
  namespace: string,
): Promise<void> {
  if (!userId) {
    throw new DomainError(ErrorCode.AUTH_UNAUTHORIZED, "Requisição não autenticada.", {
      required_namespace: namespace,
    });
  }
  if (!(await hasNamespace(client, userId, namespace))) {
    throw new DomainError(ErrorCode.RBAC_ACCESS_DENIED, "Acesso negado.", {
      required_namespace: namespace,
    });
  }
}
