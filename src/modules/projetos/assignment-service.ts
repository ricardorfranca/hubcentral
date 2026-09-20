/**
 * @file assignment-service.ts
 * @module modules/projetos
 *
 * Atribuição de tarefa (responsável único). Só é possível atribuir a quem
 * participa do projeto (dono ou membro). Atribuir publica
 * `projetos.tarefa.atribuida`.
 */

import type { PoolClient } from "pg";
import { DomainError, ErrorCode } from "../../core/errors.js";
import { log as auditLog } from "../../core/audit/audit-logger.js";
import { publish, buildEnvelope } from "../../core/events/event-bus.js";
import { getTask } from "./task-service.js";
import { isParticipant } from "./member-service.js";

/**
 * Define o responsável único de uma tarefa (ou remove, com `userId = null`).
 * Valida que o alvo participa do projeto. Audita e, ao atribuir, publica
 * `projetos.tarefa.atribuida`.
 *
 * @param client - Cliente PostgreSQL.
 * @param taskId - `id` da tarefa.
 * @param userId - `user_id` do responsável, ou `null` para remover.
 * @param actorUserId - Autor da ação.
 * @throws {DomainError} `PROJ_TASK_NOT_FOUND`/`PROJ_ACCESS_DENIED`.
 */
export async function setAssignee(
  client: PoolClient,
  taskId: string,
  userId: string | null,
  actorUserId: string | null = null,
): Promise<void> {
  const task = await getTask(client, taskId);
  if (!task) {
    throw new DomainError(ErrorCode.PROJ_TASK_NOT_FOUND, "Tarefa não encontrada.", { task_id: taskId });
  }
  if (userId && !(await isParticipant(client, task.project_id, userId))) {
    throw new DomainError(ErrorCode.PROJ_ACCESS_DENIED, "Só é possível atribuir a participantes do projeto.", {
      project_id: task.project_id, user_id: userId,
    });
  }

  const changed = task.assignee_user_id !== userId;
  await client.query(
    `UPDATE mod_projetos.tasks SET assignee_user_id = $2, updated_at = now() WHERE id = $1`,
    [taskId, userId],
  );

  await auditLog(client, {
    userId: actorUserId, module: "projetos", action: userId ? "PROJ_TAREFA_ATRIBUIDA" : "PROJ_TAREFA_DESATRIBUIDA",
    payloadAfter: { task_id: taskId, user_id: userId },
  });

  if (userId && changed) {
    await publish(
      client,
      buildEnvelope("projetos.tarefa.atribuida", "mod_projetos", {
        task_id: taskId, project_id: task.project_id, assignee_user_id: userId, actor_user_id: actorUserId,
      }),
    );
  }
}
