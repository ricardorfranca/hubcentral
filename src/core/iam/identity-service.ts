/**
 * @file identity-service.ts
 * @module core/iam
 *
 * Provisionamento e autenticação de usuários (§2 da arquitetura). Convite com
 * senha temporária, definição de senha no primeiro acesso, reenvio com cooldown
 * e autenticação por e-mail/senha.
 */

import type { PoolClient } from "pg";
import { DomainError, ErrorCode } from "../errors.js";
import { hashPassword, verifyPassword, isValidPassword } from "./password.js";
import { log as auditLog } from "../audit/audit-logger.js";

/** Senha temporária padrão de convite (§5.6 do CRM). */
export const TEMP_PASSWORD = "invite123";
/** Cooldown mínimo entre reenvios de convite, em milissegundos (60 min). */
export const RESEND_COOLDOWN_MS = 60 * 60 * 1000;

/** Papéis (níveis de acesso) do §2.2. */
export type UserRole = "superadmin" | "module_admin" | "operator" | "client";

/** Usuário do IAM (sem expor o hash de senha). */
export interface IamUser {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  status: "active" | "disabled";
  password_set: boolean;
}

/** Colunas seguras de usuário (sem password_hash). */
const USER_COLUMNS = "id, email, full_name, role, status, password_set";

/**
 * Busca um usuário por id (dados seguros, sem hash).
 *
 * @param client - Cliente PostgreSQL.
 * @param userId - `user_id`.
 * @returns O usuário, ou `null` se não existe.
 */
export async function getUserById(client: PoolClient, userId: string): Promise<IamUser | null> {
  const { rows } = await client.query<IamUser>(
    `SELECT ${USER_COLUMNS} FROM core.users WHERE id = $1`,
    [userId],
  );
  return rows[0] ?? null;
}

/**
 * Provisiona (convida) um novo usuário com senha temporária e `password_set`
 * false, exigindo definição de nova senha no primeiro acesso (§5.6).
 *
 * @param client - Cliente PostgreSQL.
 * @param input - Dados do usuário (e-mail, nome, papel).
 * @param actorUserId - Autor do provisionamento, ou `null` para SYSTEM.
 * @returns O usuário criado.
 * @throws {DomainError} `IAM_EMAIL_TAKEN` se o e-mail já existe.
 */
export async function inviteUser(
  client: PoolClient,
  input: { email: string; full_name: string; role: UserRole },
  actorUserId: string | null = null,
): Promise<IamUser> {
  const existing = await client.query<{ id: string }>(
    `SELECT id FROM core.users WHERE email = $1`,
    [input.email],
  );
  if (existing.rows[0]) {
    throw new DomainError(ErrorCode.IAM_EMAIL_TAKEN, "Já existe um usuário com este e-mail.", {
      email: input.email,
    });
  }

  const { rows } = await client.query<IamUser>(
    `INSERT INTO core.users (email, full_name, role, password_hash, password_set, invited_at)
     VALUES ($1, $2, $3, $4, false, now())
     RETURNING ${USER_COLUMNS}`,
    [input.email, input.full_name, input.role, hashPassword(TEMP_PASSWORD)],
  );
  const user = rows[0] as IamUser;

  await auditLog(client, {
    userId: actorUserId,
    module: "core",
    action: "IAM_USUARIO_CONVIDADO",
    payloadAfter: { user_id: user.id, email: user.email, role: user.role },
  });

  return user;
}

/**
 * Reenvia o convite (regenera a senha temporária), respeitando o cooldown de
 * 60 minutos entre reenvios (§5.6).
 *
 * @param client - Cliente PostgreSQL.
 * @param userId - `user_id` do convidado.
 * @param now - Instante atual (injetável para teste).
 * @throws {DomainError} `IAM_USER_NOT_FOUND` se o usuário não existe.
 * @throws {DomainError} `IAM_RESEND_COOLDOWN` se dentro do cooldown.
 */
export async function resendInvite(
  client: PoolClient,
  userId: string,
  now: Date = new Date(),
): Promise<void> {
  const { rows } = await client.query<{ password_set: boolean; invite_resent_at: Date | null; invited_at: Date | null }>(
    `SELECT password_set, invite_resent_at, invited_at FROM core.users WHERE id = $1`,
    [userId],
  );
  const user = rows[0];
  if (!user) {
    throw new DomainError(ErrorCode.IAM_USER_NOT_FOUND, "Usuário não encontrado.", { user_id: userId });
  }

  const lastSent = user.invite_resent_at ?? user.invited_at;
  if (lastSent && now.getTime() - lastSent.getTime() < RESEND_COOLDOWN_MS) {
    const waitMs = RESEND_COOLDOWN_MS - (now.getTime() - lastSent.getTime());
    throw new DomainError(ErrorCode.IAM_RESEND_COOLDOWN, "Aguarde o cooldown para reenviar o convite.", {
      wait_ms: waitMs,
    });
  }

  await client.query(
    `UPDATE core.users
     SET password_hash = $2, password_set = false, invite_resent_at = $3
     WHERE id = $1`,
    [userId, hashPassword(TEMP_PASSWORD), now],
  );
}

/**
 * Define a senha do usuário (primeiro acesso ou troca), marcando
 * `password_set = true` (§5.6). Valida a política mínima de comprimento.
 *
 * @param client - Cliente PostgreSQL.
 * @param userId - `user_id` do usuário.
 * @param newPassword - Nova senha em claro.
 * @throws {DomainError} `IAM_USER_NOT_FOUND` se o usuário não existe.
 * @throws {DomainError} `IAM_WEAK_PASSWORD` se a senha for menor que o mínimo.
 */
export async function setPassword(
  client: PoolClient,
  userId: string,
  newPassword: string,
): Promise<void> {
  if (!isValidPassword(newPassword)) {
    throw new DomainError(ErrorCode.IAM_WEAK_PASSWORD, "A senha não atende à política mínima.", {});
  }
  const { rowCount } = await client.query(
    `UPDATE core.users SET password_hash = $2, password_set = true WHERE id = $1`,
    [userId, hashPassword(newPassword)],
  );
  if ((rowCount ?? 0) === 0) {
    throw new DomainError(ErrorCode.IAM_USER_NOT_FOUND, "Usuário não encontrado.", { user_id: userId });
  }
}

/**
 * Autentica um usuário por e-mail e senha (§2). Não revela se o e-mail existe:
 * erros de credencial usam o mesmo código.
 *
 * @param client - Cliente PostgreSQL.
 * @param email - E-mail informado.
 * @param password - Senha em claro.
 * @returns O usuário autenticado.
 * @throws {DomainError} `IAM_INVALID_CREDENTIALS` se e-mail/senha não conferem.
 * @throws {DomainError} `IAM_USER_DISABLED` se a conta está desabilitada.
 */
export async function authenticate(
  client: PoolClient,
  email: string,
  password: string,
): Promise<IamUser> {
  const { rows } = await client.query<{
    id: string;
    email: string;
    full_name: string;
    role: UserRole;
    status: "active" | "disabled";
    password_set: boolean;
    password_hash: string | null;
  }>(
    `SELECT id, email, full_name, role, status, password_set, password_hash
     FROM core.users WHERE email = $1`,
    [email],
  );
  const user = rows[0];
  if (!user || !user.password_hash || !verifyPassword(password, user.password_hash)) {
    throw new DomainError(ErrorCode.IAM_INVALID_CREDENTIALS, "Credenciais inválidas.", {});
  }
  if (user.status === "disabled") {
    throw new DomainError(ErrorCode.IAM_USER_DISABLED, "Conta desabilitada.", {});
  }
  return {
    id: user.id,
    email: user.email,
    full_name: user.full_name,
    role: user.role,
    status: user.status,
    password_set: user.password_set,
  };
}
