/**
 * @file session-service.ts
 * @module core/iam
 *
 * Sessões de autenticação por token opaco. O token em claro é retornado ao
 * cliente apenas na criação; o banco guarda somente seu hash SHA-256.
 */

import type { PoolClient } from "pg";
import { randomBytes, createHash } from "node:crypto";
import { DomainError, ErrorCode } from "../errors.js";

/** Duração padrão de uma sessão, em milissegundos (12 horas). */
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

/**
 * Calcula o hash SHA-256 (hex) de um token.
 *
 * @param token - Token em claro.
 * @returns Hash hex do token.
 */
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Cria uma sessão para um usuário, retornando o token opaco em claro (guardado
 * apenas como hash).
 *
 * @param client - Cliente PostgreSQL.
 * @param userId - `user_id` da sessão.
 * @param ttlMs - Duração da sessão (default {@link SESSION_TTL_MS}).
 * @param now - Instante atual (injetável para teste).
 * @returns O token em claro e o instante de expiração.
 */
export async function createSession(
  client: PoolClient,
  userId: string,
  ttlMs: number = SESSION_TTL_MS,
  now: Date = new Date(),
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(now.getTime() + ttlMs);
  await client.query(
    `INSERT INTO core.sessions (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [userId, hashToken(token), expiresAt],
  );
  return { token, expiresAt };
}

/**
 * Valida um token de sessão e resolve o `user_id`, exigindo sessão não expirada
 * nem revogada.
 *
 * @param client - Cliente PostgreSQL.
 * @param token - Token em claro apresentado pelo cliente.
 * @param now - Instante atual (injetável para teste).
 * @returns O `user_id` associado à sessão válida.
 * @throws {DomainError} `IAM_INVALID_SESSION` se ausente, expirada ou revogada.
 */
export async function validateSession(
  client: PoolClient,
  token: string,
  now: Date = new Date(),
): Promise<string> {
  const { rows } = await client.query<{ user_id: string; expires_at: Date; revoked_at: Date | null }>(
    `SELECT user_id, expires_at, revoked_at FROM core.sessions WHERE token_hash = $1`,
    [hashToken(token)],
  );
  const session = rows[0];
  if (!session || session.revoked_at !== null || session.expires_at.getTime() <= now.getTime()) {
    throw new DomainError(ErrorCode.IAM_INVALID_SESSION, "Sessão inválida ou expirada.", {});
  }
  return session.user_id;
}

/**
 * Revoga a sessão associada a um token (logout). Idempotente.
 *
 * @param client - Cliente PostgreSQL.
 * @param token - Token em claro.
 * @returns `true` se uma sessão ativa foi revogada; `false` caso contrário.
 */
export async function revokeSession(client: PoolClient, token: string): Promise<boolean> {
  const { rowCount } = await client.query(
    `UPDATE core.sessions SET revoked_at = now()
     WHERE token_hash = $1 AND revoked_at IS NULL`,
    [hashToken(token)],
  );
  return (rowCount ?? 0) > 0;
}
