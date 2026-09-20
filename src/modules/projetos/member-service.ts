/**
 * @file member-service.ts
 * @module modules/projetos
 *
 * Gestão de membros do projeto. Membros referenciam core.users. Ao remover um
 * membro, suas atribuições de tarefa no projeto são removidas (as tarefas
 * permanecem).
 */

import type { PoolClient } from "pg";
import { log as auditLog } from "../../core/audit/audit-logger.js";

/** Membro de projeto com dados básicos resolvidos de core.users. */
export interface ProjectMember {
  user_id: string;
  full_name: string | null;
  email: string;
  added_at: Date;
}

/**
 * Adiciona um usuário como membro do projeto. Idempotente. Audita.
 *
 * @param client - Cliente PostgreSQL.
 * @param projectId - `id` do projeto.
 * @param userId - `user_id` a adicionar.
 * @param actorUserId - Autor.
 */
export async function addMember(
  client: PoolClient,
  projectId: string,
  userId: string,
  actorUserId: string | null = null,
): Promise<void> {
  await client.query(
    `INSERT INTO mod_projetos.project_members (project_id, user_id)
     VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [projectId, userId],
  );
  await auditLog(client, {
    userId: actorUserId,
    module: "projetos",
    action: "PROJ_MEMBRO_ADICIONADO",
    payloadAfter: { project_id: projectId, user_id: userId },
  });
}

/**
 * Remove um membro do projeto e suas atribuições nas tarefas do projeto (as
 * tarefas em si são mantidas). Audita.
 *
 * @param client - Cliente PostgreSQL.
 * @param projectId - `id` do projeto.
 * @param userId - `user_id` a remover.
 * @param actorUserId - Autor.
 */
export async function removeMember(
  client: PoolClient,
  projectId: string,
  userId: string,
  actorUserId: string | null = null,
): Promise<void> {
  await client.query(
    `DELETE FROM mod_projetos.project_members WHERE project_id = $1 AND user_id = $2`,
    [projectId, userId],
  );
  // Remove atribuições do usuário nas tarefas deste projeto (mantém as tarefas).
  await client.query(
    `DELETE FROM mod_projetos.task_assignees ta
     USING mod_projetos.tasks t
     WHERE ta.task_id = t.id AND t.project_id = $1 AND ta.user_id = $2`,
    [projectId, userId],
  );
  await auditLog(client, {
    userId: actorUserId,
    module: "projetos",
    action: "PROJ_MEMBRO_REMOVIDO",
    payloadAfter: { project_id: projectId, user_id: userId },
  });
}

/**
 * Lista os membros de um projeto com nome/e-mail resolvidos.
 *
 * @param client - Cliente PostgreSQL.
 * @param projectId - `id` do projeto.
 * @returns Os membros do projeto.
 */
export async function listMembers(client: PoolClient, projectId: string): Promise<ProjectMember[]> {
  const { rows } = await client.query<ProjectMember>(
    `SELECT m.user_id, u.full_name, u.email, m.added_at
     FROM mod_projetos.project_members m
     JOIN core.users u ON u.id = m.user_id
     WHERE m.project_id = $1
     ORDER BY u.full_name`,
    [projectId],
  );
  return rows;
}

/**
 * Indica se um usuário é dono ou membro do projeto (para validações de
 * atribuição). 
 *
 * @param client - Cliente PostgreSQL.
 * @param projectId - `id` do projeto.
 * @param userId - `user_id` a verificar.
 * @returns `true` se participa do projeto.
 */
export async function isParticipant(client: PoolClient, projectId: string, userId: string): Promise<boolean> {
  const { rows } = await client.query<{ ok: boolean }>(
    `SELECT (
       EXISTS (SELECT 1 FROM mod_projetos.projects WHERE id = $1 AND owner_user_id = $2)
       OR EXISTS (SELECT 1 FROM mod_projetos.project_members WHERE project_id = $1 AND user_id = $2)
     ) AS ok`,
    [projectId, userId],
  );
  return rows[0]?.ok ?? false;
}
