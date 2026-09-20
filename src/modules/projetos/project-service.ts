/**
 * @file project-service.ts
 * @module modules/projetos
 *
 * Serviço de Projetos Internos. Um projeto tem dono e membros (referências a
 * core.users), descritivo principal, e status ativo/arquivado. O acesso é
 * restrito a dono ou membro — a listagem só retorna os projetos do usuário e o
 * detalhe é negado a não-participantes.
 */

import type { PoolClient } from "pg";
import { DomainError, ErrorCode } from "../../core/errors.js";
import { log as auditLog } from "../../core/audit/audit-logger.js";

/** Projeto como persistido em `mod_projetos.projects`. */
export interface Project {
  id: string;
  name: string;
  description: string | null;
  detail: string | null;
  owner_user_id: string;
  status: "ativo" | "arquivado";
  created_at: Date;
  updated_at: Date;
}

/** Projeto com membros e comentários resolvidos. */
export interface ProjectView extends Project {
  members: { user_id: string; full_name: string | null; email: string }[];
  comments: { id: string; author_user_id: string; author_name: string | null; body: string; created_at: Date }[];
}

const COLUMNS = "id, name, description, detail, owner_user_id, status, created_at, updated_at";

/**
 * Verifica se o usuário é dono ou membro do projeto; lança se não for.
 *
 * @param client - Cliente PostgreSQL.
 * @param userId - `user_id` autenticado.
 * @param projectId - `id` do projeto.
 * @throws {DomainError} `PROJ_NOT_FOUND` se o projeto não existe.
 * @throws {DomainError} `PROJ_ACCESS_DENIED` se o usuário não participa.
 */
export async function assertProjectAccess(
  client: PoolClient,
  userId: string | null,
  projectId: string,
): Promise<void> {
  if (!userId) {
    throw new DomainError(ErrorCode.AUTH_UNAUTHORIZED, "Requisição não autenticada.", {});
  }
  const { rows } = await client.query<{ owner_user_id: string }>(
    `SELECT owner_user_id FROM mod_projetos.projects WHERE id = $1`,
    [projectId],
  );
  const project = rows[0];
  if (!project) {
    throw new DomainError(ErrorCode.PROJ_NOT_FOUND, "Projeto não encontrado.", { project_id: projectId });
  }
  if (project.owner_user_id === userId) return;
  const member = await client.query(
    `SELECT 1 FROM mod_projetos.project_members WHERE project_id = $1 AND user_id = $2`,
    [projectId, userId],
  );
  if (member.rowCount === 0) {
    throw new DomainError(ErrorCode.PROJ_ACCESS_DENIED, "Acesso negado ao projeto.", { project_id: projectId });
  }
}

/**
 * Garante que o projeto não está arquivado (para operações de escrita).
 *
 * @param client - Cliente PostgreSQL.
 * @param projectId - `id` do projeto.
 * @throws {DomainError} `PROJ_ARCHIVED` se o projeto estiver arquivado.
 */
export async function assertNotArchived(client: PoolClient, projectId: string): Promise<void> {
  const { rows } = await client.query<{ status: string }>(
    `SELECT status FROM mod_projetos.projects WHERE id = $1`,
    [projectId],
  );
  if (rows[0]?.status === "arquivado") {
    throw new DomainError(ErrorCode.PROJ_ARCHIVED, "Projeto arquivado; operação não permitida.", { project_id: projectId });
  }
}

/**
 * Cria um projeto e adiciona o dono como membro. Audita.
 *
 * @param client - Cliente PostgreSQL.
 * @param input - Dados do projeto (o `ownerUserId` default é o autor).
 * @param actorUserId - Autor.
 * @returns O projeto criado.
 */
export async function createProject(
  client: PoolClient,
  input: { name: string; description?: string | undefined; detail?: string | undefined; ownerUserId?: string | undefined },
  actorUserId: string | null = null,
): Promise<Project> {
  const ownerId = input.ownerUserId ?? actorUserId;
  if (!ownerId) {
    throw new DomainError(ErrorCode.AUTH_UNAUTHORIZED, "Dono do projeto não informado.", {});
  }
  const { rows } = await client.query<Project>(
    `INSERT INTO mod_projetos.projects (name, description, detail, owner_user_id, created_by)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING ${COLUMNS}`,
    [input.name, input.description ?? null, input.detail ?? null, ownerId, actorUserId],
  );
  const project = rows[0] as Project;

  // Dono também é membro (idempotente).
  await client.query(
    `INSERT INTO mod_projetos.project_members (project_id, user_id)
     VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [project.id, ownerId],
  );

  await auditLog(client, {
    userId: actorUserId,
    module: "projetos",
    action: "PROJ_PROJETO_CRIADO",
    payloadAfter: { project_id: project.id, owner_user_id: ownerId },
  });
  return project;
}

/**
 * Edita nome, descrição, descritivo principal e/ou dono de um projeto. Audita.
 *
 * @param client - Cliente PostgreSQL.
 * @param id - `id` do projeto.
 * @param patch - Campos a alterar.
 * @param actorUserId - Autor.
 * @returns O projeto atualizado, ou `null` se não existe.
 */
export async function updateProject(
  client: PoolClient,
  id: string,
  patch: { name?: string; description?: string | null; detail?: string | null; ownerUserId?: string },
  actorUserId: string | null = null,
): Promise<Project | null> {
  const { rows } = await client.query<Project>(
    `UPDATE mod_projetos.projects SET
       name = COALESCE($2, name),
       description = COALESCE($3, description),
       detail = COALESCE($4, detail),
       owner_user_id = COALESCE($5, owner_user_id),
       updated_at = now()
     WHERE id = $1 RETURNING ${COLUMNS}`,
    [id, patch.name ?? null, patch.description ?? null, patch.detail ?? null, patch.ownerUserId ?? null],
  );
  const project = rows[0] ?? null;
  if (!project) return null;

  // Se o dono mudou, garante que ele é membro.
  if (patch.ownerUserId) {
    await client.query(
      `INSERT INTO mod_projetos.project_members (project_id, user_id)
       VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [id, patch.ownerUserId],
    );
  }

  await auditLog(client, {
    userId: actorUserId,
    module: "projetos",
    action: "PROJ_PROJETO_EDITADO",
    payloadAfter: { project_id: id },
  });
  return project;
}

/**
 * Arquiva um projeto (status `arquivado`). Audita.
 *
 * @param client - Cliente PostgreSQL.
 * @param id - `id` do projeto.
 * @param actorUserId - Autor.
 * @returns O projeto arquivado, ou `null` se não existe.
 */
export async function archiveProject(
  client: PoolClient,
  id: string,
  actorUserId: string | null = null,
): Promise<Project | null> {
  const { rows } = await client.query<Project>(
    `UPDATE mod_projetos.projects SET status = 'arquivado', updated_at = now()
     WHERE id = $1 RETURNING ${COLUMNS}`,
    [id],
  );
  const project = rows[0] ?? null;
  if (!project) return null;
  await auditLog(client, {
    userId: actorUserId,
    module: "projetos",
    action: "PROJ_PROJETO_ARQUIVADO",
    payloadAfter: { project_id: id },
  });
  return project;
}

/**
 * Lista os projetos em que o usuário é dono ou membro (fonte da regra de
 * acesso: não retorna projetos alheios).
 *
 * @param client - Cliente PostgreSQL.
 * @param userId - `user_id` autenticado.
 * @returns Os projetos do usuário, mais recentes primeiro.
 */
export async function listProjectsForUser(client: PoolClient, userId: string): Promise<Project[]> {
  const { rows } = await client.query<Project>(
    `SELECT ${COLUMNS.split(", ").map((c) => `p.${c}`).join(", ")}
     FROM mod_projetos.projects p
     WHERE p.owner_user_id = $1
        OR EXISTS (SELECT 1 FROM mod_projetos.project_members m WHERE m.project_id = p.id AND m.user_id = $1)
     ORDER BY p.updated_at DESC`,
    [userId],
  );
  return rows;
}

/**
 * Retorna o detalhe de um projeto (com membros e comentários), aplicando a
 * regra de acesso: só dono ou membro.
 *
 * @param client - Cliente PostgreSQL.
 * @param id - `id` do projeto.
 * @param userId - `user_id` autenticado.
 * @returns A visão do projeto.
 * @throws {DomainError} `PROJ_NOT_FOUND`/`PROJ_ACCESS_DENIED` conforme o caso.
 */
export async function getProject(client: PoolClient, id: string, userId: string): Promise<ProjectView> {
  await assertProjectAccess(client, userId, id);
  const { rows } = await client.query<Project>(
    `SELECT ${COLUMNS} FROM mod_projetos.projects WHERE id = $1`,
    [id],
  );
  const project = rows[0] as Project;

  const members = await client.query<{ user_id: string; full_name: string | null; email: string }>(
    `SELECT m.user_id, u.full_name, u.email
     FROM mod_projetos.project_members m
     JOIN core.users u ON u.id = m.user_id
     WHERE m.project_id = $1
     ORDER BY u.full_name`,
    [id],
  );
  const comments = await client.query<{ id: string; author_user_id: string; author_name: string | null; body: string; created_at: Date }>(
    `SELECT c.id, c.author_user_id, u.full_name AS author_name, c.body, c.created_at
     FROM mod_projetos.project_comments c
     JOIN core.users u ON u.id = c.author_user_id
     WHERE c.project_id = $1
     ORDER BY c.created_at`,
    [id],
  );
  return { ...project, members: members.rows, comments: comments.rows };
}
