/**
 * @file assignment-service.ts
 * @module modules/projetos
 *
 * Atribuição de tarefas a usuários. Só é possível atribuir a quem participa do
 * projeto (dono ou membro). Atribuir publica `projetos.tarefa.atribuida`.
 */

import type { PoolClient } from "pg";
import { DomainError, ErrorCode } from "../../core/errors.js";
import { log as auditLog } from "../../core/audit/audit-logger.js";
import { publish, buildEnvelope } from "../../core/events/event-bus.js";
import { getTask } from "./task-service.js";
import { isParticipant } from "./member-service.js";

/**
 * Atribui uma tarefa a um usuário. Valida que o alvo participa do projeto.
 * Idempotente. Audita e publica `projetos.tarefa.atribuida`.
 *
 * @param client - Cliente PostgreSQL.
 * @param taskId - `id` da tarefa.
 * @param userId - `user_id` a atribuir.
 * @param actorUserId - Autor da atribuição.
 * @throws {DomainError} `PROJ_TASK_NOT_FOUND` se a tarefa não existe.
 * @throws {DomainError} `PROJ_ACCESS_DENIED` se o alvo não participa do projeto.
 */
export async function assign(
  client: PoolClient,
  taskId: string,
  userId: string,
  actorUserId: string | null = null,
): Promise<void> {
  const task = await getTask(client, taskId);
  if (!task) {
    throw new DomainError(ErrorCode.PROJ_TASK_NOT_FOUND, "Tarefa não encontrada.", { task_id: taskId });
  }
  if (!(await isParticipant(client, task.project_id, userId))) {
    throw new DomainError(ErrorCode.PROJ_ACCESS_DENIED, "Só é possível atribuir a participantes do projeto.", {
      project_id: task.project_id,
      user_id: userId,
    });
  }

  const { rowCount } = await client.query(
    `INSERT INTO mod_projetos.task_assignees (task_id, user_id)
     VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [taskId, userId],
  );

  // Só audita/notifica quando a atribuição é nova.
  if (rowCount && rowCount > 0) {
    await auditLog(client, {
      userId: actorUserId,
      module: "projetos",
      action: "PROJ_TAREFA_ATRIBUIDA",
      payloadAfter: { task_id: taskId, user_id: userId },
    });
    await publish(
      client,
      buildEnvelope("projetos.tarefa.atribuida", "mod_projetos", {
        task_id: taskId,
        project_id: task.project_id,
        assignee_user_id: userId,
        actor_user_id: actorUserId,
      }),
    );
  }
}

/**
 * Remove a atribuição de um usuário em uma tarefa. Idempotente. Audita.
 *
 * @param client - Cliente PostgreSQL.
 * @param taskId - `id` da tarefa.
 * @param userId - `user_id` a desatribuir.
 * @param actorUserId - Autor.
 */
export async function unassign(
  client: PoolClient,
  taskId: string,
  userId: string,
  actorUserId: string | null = null,
): Promise<void> {
  await client.query(
    `DELETE FROM mod_projetos.task_assignees WHERE task_id = $1 AND user_id = $2`,
    [taskId, userId],
  );
  await auditLog(client, {
    userId: actorUserId,
    module: "projetos",
    action: "PROJ_TAREFA_DESATRIBUIDA",
    payloadAfter: { task_id: taskId, user_id: userId },
  });
}

/**
 * Lista os `user_id` atribuídos a uma tarefa.
 *
 * @param client - Cliente PostgreSQL.
 * @param taskId - `id` da tarefa.
 * @returns Os ids dos atribuídos.
 */
export async function listAssignees(client: PoolClient, taskId: string): Promise<string[]> {
  const { rows } = await client.query<{ user_id: string }>(
    `SELECT user_id FROM mod_projetos.task_assignees WHERE task_id = $1`,
    [taskId],
  );
  return rows.map((r) => r.user_id);
}
