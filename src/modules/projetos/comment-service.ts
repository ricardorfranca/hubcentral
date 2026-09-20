/**
 * @file comment-service.ts
 * @module modules/projetos
 *
 * Comentários no nível de tarefa e de projeto. Cada criação audita e publica um
 * evento (que o notifier converte em notificações para os envolvidos).
 */

import type { PoolClient } from "pg";
import { DomainError, ErrorCode } from "../../core/errors.js";
import { log as auditLog } from "../../core/audit/audit-logger.js";
import { publish, buildEnvelope } from "../../core/events/event-bus.js";
import { getTask } from "./task-service.js";

/** Comentário como persistido (tarefa ou projeto). */
export interface Comment {
  id: string;
  author_user_id: string;
  body: string;
  created_at: Date;
}

/**
 * Adiciona um comentário a uma tarefa. Audita e publica
 * `projetos.comentario.criado`.
 *
 * @param client - Cliente PostgreSQL.
 * @param taskId - `id` da tarefa.
 * @param authorUserId - Autor do comentário.
 * @param body - Texto do comentário.
 * @returns O comentário criado.
 * @throws {DomainError} `PROJ_TASK_NOT_FOUND` se a tarefa não existe.
 */
export async function addTaskComment(
  client: PoolClient,
  taskId: string,
  authorUserId: string,
  body: string,
): Promise<Comment> {
  const task = await getTask(client, taskId);
  if (!task) {
    throw new DomainError(ErrorCode.PROJ_TASK_NOT_FOUND, "Tarefa não encontrada.", { task_id: taskId });
  }
  const { rows } = await client.query<Comment>(
    `INSERT INTO mod_projetos.task_comments (task_id, author_user_id, body)
     VALUES ($1, $2, $3)
     RETURNING id, author_user_id, body, created_at`,
    [taskId, authorUserId, body],
  );
  const comment = rows[0] as Comment;
  await auditLog(client, {
    userId: authorUserId,
    module: "projetos",
    action: "PROJ_COMENTARIO_TAREFA_CRIADO",
    payloadAfter: { task_id: taskId, comment_id: comment.id },
  });
  await publish(
    client,
    buildEnvelope("projetos.comentario.criado", "mod_projetos", {
      task_id: taskId,
      project_id: task.project_id,
      comment_id: comment.id,
      actor_user_id: authorUserId,
    }),
  );
  return comment;
}

/**
 * Adiciona um comentário no nível do projeto. Audita e publica
 * `projetos.projeto.comentario.criado`.
 *
 * @param client - Cliente PostgreSQL.
 * @param projectId - `id` do projeto.
 * @param authorUserId - Autor do comentário.
 * @param body - Texto do comentário.
 * @returns O comentário criado.
 */
export async function addProjectComment(
  client: PoolClient,
  projectId: string,
  authorUserId: string,
  body: string,
): Promise<Comment> {
  const { rows } = await client.query<Comment>(
    `INSERT INTO mod_projetos.project_comments (project_id, author_user_id, body)
     VALUES ($1, $2, $3)
     RETURNING id, author_user_id, body, created_at`,
    [projectId, authorUserId, body],
  );
  const comment = rows[0] as Comment;
  await auditLog(client, {
    userId: authorUserId,
    module: "projetos",
    action: "PROJ_COMENTARIO_PROJETO_CRIADO",
    payloadAfter: { project_id: projectId, comment_id: comment.id },
  });
  await publish(
    client,
    buildEnvelope("projetos.projeto.comentado", "mod_projetos", {
      project_id: projectId,
      comment_id: comment.id,
      actor_user_id: authorUserId,
    }),
  );
  return comment;
}

/**
 * Lista os comentários de uma tarefa em ordem cronológica.
 *
 * @param client - Cliente PostgreSQL.
 * @param taskId - `id` da tarefa.
 * @returns Os comentários da tarefa (com nome do autor).
 */
export async function listTaskComments(
  client: PoolClient,
  taskId: string,
): Promise<(Comment & { author_name: string | null })[]> {
  const { rows } = await client.query<Comment & { author_name: string | null }>(
    `SELECT c.id, c.author_user_id, u.full_name AS author_name, c.body, c.created_at
     FROM mod_projetos.task_comments c
     JOIN core.users u ON u.id = c.author_user_id
     WHERE c.task_id = $1
     ORDER BY c.created_at`,
    [taskId],
  );
  return rows;
}
