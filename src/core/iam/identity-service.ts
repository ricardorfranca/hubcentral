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
  status: "active" | "disabled" | "deleted";
  password_set: boolean;
  /** Ramal do usuário no PABX (discagem via curl). */
  extension: string | null;
}

/** Colunas seguras de usuário (sem password_hash). */
const USER_COLUMNS = "id, email, full_name, role, status, password_set, extension";

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
 * Lista todos os usuários (dados seguros), ordenados por e-mail.
 *
 * @param client - Cliente PostgreSQL.
 * @returns Lista de usuários.
 */
export async function listUsers(client: PoolClient): Promise<IamUser[]> {
  // Oculta as lápides (status='deleted') da administração: usuários excluídos
  // deixam de existir operacionalmente (RF2).
  const { rows } = await client.query<IamUser>(
    `SELECT ${USER_COLUMNS} FROM core.users WHERE status <> 'deleted' ORDER BY email`,
  );
  return rows;
}

/** Usuário reduzido ao necessário para preencher um seletor na interface. */
export interface UserOption {
  id: string;
  full_name: string;
  email: string;
}

/**
 * Lista os usuários ATIVOS reduzidos a `id`/nome/e-mail, para alimentar
 * seletores de responsável (ex.: gerente de contas de uma empresa) sem exigir
 * a permissão de administração de usuários nem expor papel/status/senha.
 *
 * @param client - Cliente PostgreSQL.
 * @returns Usuários ativos ordenados por nome.
 */
export async function listUserOptions(client: PoolClient): Promise<UserOption[]> {
  const { rows } = await client.query<UserOption>(
    `SELECT id, full_name, email FROM core.users
     WHERE status = 'active'
     ORDER BY full_name, email`,
  );
  return rows;
}

/**
 * Altera o papel (nível de acesso) de um usuário (Req §2.2). Auditado.
 *
 * @param client - Cliente PostgreSQL.
 * @param userId - `user_id` alvo.
 * @param role - Novo papel.
 * @param actorUserId - Autor da alteração.
 * @throws {DomainError} `IAM_USER_NOT_FOUND` se o usuário não existe.
 */
export async function setUserRole(
  client: PoolClient,
  userId: string,
  role: UserRole,
  actorUserId: string | null = null,
): Promise<void> {
  const before = await getUserById(client, userId);
  if (!before) {
    throw new DomainError(ErrorCode.IAM_USER_NOT_FOUND, "Usuário não encontrado.", { user_id: userId });
  }
  await client.query(`UPDATE core.users SET role = $2 WHERE id = $1`, [userId, role]);
  await auditLog(client, {
    userId: actorUserId,
    module: "core",
    action: "IAM_PAPEL_ALTERADO",
    payloadBefore: { role: before.role },
    payloadAfter: { role },
  });
}

/**
 * Ativa ou desativa um usuário. Auditado.
 *
 * @param client - Cliente PostgreSQL.
 * @param userId - `user_id` alvo.
 * @param status - Novo status.
 * @param actorUserId - Autor da alteração.
 * @throws {DomainError} `IAM_USER_NOT_FOUND` se o usuário não existe.
 */
export async function setUserStatus(
  client: PoolClient,
  userId: string,
  status: "active" | "disabled",
  actorUserId: string | null = null,
): Promise<void> {
  const before = await getUserById(client, userId);
  if (!before) {
    throw new DomainError(ErrorCode.IAM_USER_NOT_FOUND, "Usuário não encontrado.", { user_id: userId });
  }
  await client.query(`UPDATE core.users SET status = $2 WHERE id = $1`, [userId, status]);
  await auditLog(client, {
    userId: actorUserId,
    module: "core",
    action: "IAM_STATUS_ALTERADO",
    payloadBefore: { status: before.status },
    payloadAfter: { status },
  });
}

/**
 * Define (ou limpa) o ramal do usuário no PABX. Auditado.
 *
 * @param client - Cliente PostgreSQL.
 * @param userId - `user_id` alvo.
 * @param extension - Ramal (string) ou `null` para remover.
 * @param actorUserId - Autor da alteração.
 * @throws {DomainError} `IAM_USER_NOT_FOUND` se o usuário não existe.
 */
export async function setUserExtension(
  client: PoolClient,
  userId: string,
  extension: string | null,
  actorUserId: string | null = null,
): Promise<void> {
  const before = await getUserById(client, userId);
  if (!before) {
    throw new DomainError(ErrorCode.IAM_USER_NOT_FOUND, "Usuário não encontrado.", { user_id: userId });
  }
  const value = extension && extension.trim() !== "" ? extension.trim() : null;
  await client.query(`UPDATE core.users SET extension = $2 WHERE id = $1`, [userId, value]);
  await auditLog(client, {
    userId: actorUserId,
    module: "core",
    action: "IAM_RAMAL_ALTERADO",
    payloadBefore: { extension: before.extension },
    payloadAfter: { extension: value },
  });
}

/** Domínio reservado para e-mails de lápide (usuário excluído). */
const DELETED_EMAIL_DOMAIN = "@deleted.local";

/**
 * Atualiza nome e/ou e-mail de um usuário (RF1). Campos ausentes não são
 * tocados; chamada sem campos não altera dados nem gera auditoria. Auditado.
 *
 * @param client - Cliente PostgreSQL.
 * @param userId - `user_id` alvo.
 * @param patch - Campos a atualizar (`full_name` e/ou `email`), ambos opcionais.
 * @param actorUserId - Autor da alteração.
 * @returns O usuário atualizado.
 * @throws {DomainError} `IAM_USER_NOT_FOUND` se o usuário não existe.
 * @throws {DomainError} `IAM_INVALID_NAME` se `full_name` vier vazio/em branco.
 * @throws {DomainError} `IAM_INVALID_EMAIL` se o e-mail estiver no domínio reservado `@deleted.local`.
 * @throws {DomainError} `IAM_EMAIL_TAKEN` se o e-mail já for de OUTRO usuário.
 */
export async function setUserProfile(
  client: PoolClient,
  userId: string,
  patch: { full_name?: string | undefined; email?: string | undefined },
  actorUserId: string | null = null,
): Promise<IamUser> {
  const before = await getUserById(client, userId);
  if (!before) {
    throw new DomainError(ErrorCode.IAM_USER_NOT_FOUND, "Usuário não encontrado.", { user_id: userId });
  }

  // Normaliza e valida os campos presentes no patch.
  let name: string | undefined;
  if (patch.full_name !== undefined) {
    name = patch.full_name.trim();
    if (name === "") {
      throw new DomainError(ErrorCode.IAM_INVALID_NAME, "O nome não pode ficar em branco.", { user_id: userId });
    }
  }

  let email: string | undefined;
  if (patch.email !== undefined) {
    email = patch.email.trim();
    // O domínio-sentinela é reservado às lápides (deleted+<id>@deleted.local);
    // digitá-lo manualmente arriscaria colisão/confusão com um usuário excluído.
    if (email.toLowerCase().endsWith(DELETED_EMAIL_DOMAIN)) {
      throw new DomainError(ErrorCode.IAM_INVALID_EMAIL, "Este e-mail usa um domínio reservado pelo sistema.", {
        email,
      });
    }
    // Duplicidade só contra OUTROS usuários; reenviar o próprio e-mail é aceito.
    const dup = await client.query<{ id: string }>(
      `SELECT id FROM core.users WHERE email = $1 AND id <> $2`,
      [email, userId],
    );
    if (dup.rows[0]) {
      throw new DomainError(ErrorCode.IAM_EMAIL_TAKEN, "Já existe um usuário com este e-mail.", { email });
    }
  }

  // Monta o SET dinamicamente, só com as colunas presentes (sem COALESCE).
  const sets: string[] = [];
  const vals: unknown[] = [userId];
  if (name !== undefined) {
    sets.push(`full_name = $${vals.push(name)}`);
  }
  if (email !== undefined) {
    sets.push(`email = $${vals.push(email)}`);
  }
  if (sets.length === 0) {
    // RF1.3 — nada a atualizar: não altera dados nem registra auditoria.
    return before;
  }
  sets.push(`updated_at = now()`);

  try {
    await client.query(`UPDATE core.users SET ${sets.join(", ")} WHERE id = $1`, vals);
  } catch (err) {
    // Defesa em profundidade: o dono do invariante UNIQUE(email) é o banco.
    // Remapeia a corrida (unique_violation) para a mensagem pt-BR amigável.
    if ((err as { code?: string }).code === "23505") {
      throw new DomainError(ErrorCode.IAM_EMAIL_TAKEN, "Já existe um usuário com este e-mail.", { email });
    }
    throw err;
  }

  // Audita só os campos efetivamente alterados.
  const payloadBefore: Record<string, unknown> = {};
  const payloadAfter: Record<string, unknown> = {};
  if (name !== undefined) {
    payloadBefore.full_name = before.full_name;
    payloadAfter.full_name = name;
  }
  if (email !== undefined) {
    payloadBefore.email = before.email;
    payloadAfter.email = email;
  }
  await auditLog(client, {
    userId: actorUserId,
    module: "core",
    action: "IAM_PERFIL_ALTERADO",
    payloadBefore,
    payloadAfter,
  });

  return (await getUserById(client, userId)) as IamUser;
}

/**
 * "Exclui" um usuário (lápide): reatribui o trabalho ativo ao destino, remove
 * os dados estritamente por-usuário, anula/preserva históricos conforme o mapa
 * de FKs e anonimiza a linha, preservando o `id` para a integridade dos logs
 * imutáveis (`core.system_logs` NUNCA é tocado). Operação atômica: DEVE rodar
 * dentro de uma transação do chamador (`withTransaction`). Auditado antes das
 * mutações, na mesma transação (durabilidade só no COMMIT).
 *
 * @param client - Cliente PostgreSQL (transacional).
 * @param userId - `user_id` a excluir.
 * @param reassignToUserId - `user_id` de destino do trabalho ativo (obrigatório).
 * @param actorUserId - Autor da exclusão.
 * @throws {DomainError} `IAM_USER_NOT_FOUND` se a origem não existe ou já é lápide.
 * @throws {DomainError} `IAM_CANNOT_DELETE_SELF` se o autor tenta se excluir.
 * @throws {DomainError} `IAM_REASSIGN_TARGET_SAME` se o destino é a própria origem.
 * @throws {DomainError} `IAM_REASSIGN_TARGET_NOT_FOUND` se o destino não existe.
 * @throws {DomainError} `IAM_REASSIGN_TARGET_INACTIVE` se o destino não está ativo.
 * @throws {DomainError} `IAM_LAST_SUPERADMIN` se removeria o último superadmin ativo.
 */
export async function deleteUser(
  client: PoolClient,
  userId: string,
  reassignToUserId: string,
  actorUserId: string | null = null,
): Promise<void> {
  // --- Validações (a ordem importa) ---
  const origin = await getUserById(client, userId);
  if (!origin || origin.status === "deleted") {
    // Lápide já existente é tratada como inexistente para a administração.
    throw new DomainError(ErrorCode.IAM_USER_NOT_FOUND, "Usuário não encontrado.", { user_id: userId });
  }
  if (actorUserId === userId) {
    throw new DomainError(ErrorCode.IAM_CANNOT_DELETE_SELF, "Você não pode excluir a própria conta.", {
      user_id: userId,
    });
  }
  if (reassignToUserId === userId) {
    throw new DomainError(
      ErrorCode.IAM_REASSIGN_TARGET_SAME,
      "O usuário de destino não pode ser o próprio usuário excluído.",
      { user_id: userId },
    );
  }
  const target = await getUserById(client, reassignToUserId);
  if (!target) {
    throw new DomainError(ErrorCode.IAM_REASSIGN_TARGET_NOT_FOUND, "Usuário de destino não encontrado.", {
      reassign_to_user_id: reassignToUserId,
    });
  }
  if (target.status !== "active") {
    throw new DomainError(ErrorCode.IAM_REASSIGN_TARGET_INACTIVE, "O usuário de destino não está ativo.", {
      reassign_to_user_id: reassignToUserId,
    });
  }
  if (origin.role === "superadmin") {
    const { rows } = await client.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM core.users
       WHERE role = 'superadmin' AND status = 'active' AND id <> $1`,
      [userId],
    );
    if (Number(rows[0]!.c) === 0) {
      throw new DomainError(
        ErrorCode.IAM_LAST_SUPERADMIN,
        "Não é possível excluir o último superadministrador ativo.",
        { user_id: userId },
      );
    }
  }

  // --- Auditoria ANTES das mutações, na mesma transação (RF2.7) ---
  // Registra o estado real antes da anonimização; a linha de system_logs
  // referencia o AUTOR (não a origem), e a autoexclusão é barrada acima, então
  // o autor nunca é a linha anonimizada. A durabilidade vem só do COMMIT.
  await auditLog(client, {
    userId: actorUserId,
    module: "core",
    action: "IAM_USUARIO_EXCLUIDO",
    payloadBefore: { id: origin.id, email: origin.email, full_name: origin.full_name, role: origin.role },
    payloadAfter: { reassigned_to: target.id },
  });

  // --- Reatribuição do trabalho ativo (Categoria 1 + account_manager) ---
  // SET <col> = destino WHERE <col> = origem. Todas são colunas simples (sem PK
  // composta de usuário) => sem risco de colisão.
  const reassign: { table: string; column: string }[] = [
    { table: "core.segments", column: "created_by" },
    { table: "core.settings", column: "updated_by" },
    { table: "core.user_channels", column: "updated_by" },
    { table: "mod_crm.leads", column: "assigned_to" },
    { table: "mod_crm.leads", column: "created_by" },
    { table: "mod_crm.sla_config", column: "updated_by" },
    { table: "mod_crm.accounts", column: "owner_user_id" },
    { table: "mod_crm.opportunities", column: "owner_user_id" },
    { table: "mod_crm.opportunities", column: "created_by" },
    { table: "mod_crm.activities", column: "assigned_to" },
    { table: "mod_crm.activities", column: "created_by" },
    { table: "mod_crm.campaigns", column: "created_by" },
    { table: "mod_projetos.projects", column: "owner_user_id" },
    { table: "mod_projetos.projects", column: "created_by" },
    { table: "mod_projetos.tasks", column: "created_by" },
    { table: "mod_projetos.tasks", column: "assignee_user_id" },
    { table: "mod_projetos.project_comments", column: "author_user_id" },
    { table: "mod_projetos.task_comments", column: "author_user_id" },
    { table: "mod_projetos.task_attachments", column: "uploaded_by" },
    { table: "core.contacts", column: "account_manager_user_id" },
  ];
  for (const { table, column } of reassign) {
    await client.query(
      `UPDATE ${table} SET ${column} = $2 WHERE ${column} = $1`,
      [userId, reassignToUserId],
    );
  }

  // --- Histórico (Categoria 2): SET NULL na FK, preservando o nome snapshot ---
  // Não reatribuir: reescreveria "quem fez a ação". Não tocar em
  // user_name/from_user_name (snapshots de autoria).
  await client.query(`UPDATE mod_crm.lead_timeline SET user_id = NULL WHERE user_id = $1`, [userId]);
  await client.query(`UPDATE mod_crm.messages SET from_user_id = NULL WHERE from_user_id = $1`, [userId]);

  // --- API keys (Categoria 5): anula o autor; a chave segue válida ---
  await client.query(`UPDATE core.api_keys SET created_by = NULL WHERE created_by = $1`, [userId]);

  // --- Dados estritamente por-usuário (Categoria 4): DELETE explícito ---
  // Reproduz o efeito do ON DELETE CASCADE, que não dispara sem delete físico
  // do pai. Nenhuma destas tabelas é imutável.
  await client.query(`DELETE FROM core.user_permissions WHERE user_id = $1`, [userId]);
  await client.query(`DELETE FROM core.sessions WHERE user_id = $1`, [userId]);
  await client.query(`DELETE FROM core.user_channels WHERE user_id = $1`, [userId]);
  await client.query(`DELETE FROM core.notifications WHERE recipient_user_id = $1`, [userId]);
  await client.query(`DELETE FROM mod_crm.message_reads WHERE user_id = $1`, [userId]);
  await client.query(`DELETE FROM mod_projetos.project_members WHERE user_id = $1`, [userId]);
  await client.query(`DELETE FROM mod_projetos.task_assignees WHERE user_id = $1`, [userId]);

  // --- Lápide: anonimiza a PII e marca como excluído, preservando o id ---
  // O e-mail sentinela 'deleted+<id>@deleted.local' é único por construção
  // (não colide com o índice UNIQUE de citext).
  await client.query(
    `UPDATE core.users
     SET status = 'deleted',
         deleted_at = now(),
         deleted_by = $2,
         full_name = 'Usuário excluído',
         email = 'deleted+' || id || '@deleted.local',
         password_hash = NULL,
         password_set = false
     WHERE id = $1`,
    [userId, actorUserId],
  );

  // Categoria 3 (core.system_logs): NADA — imutável, preservado por construção.
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
    status: "active" | "disabled" | "deleted";
    password_set: boolean;
    password_hash: string | null;
    extension: string | null;
  }>(
    `SELECT id, email, full_name, role, status, password_set, password_hash, extension
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
    extension: user.extension,
  };
}
