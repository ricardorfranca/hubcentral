/**
 * @file task-service.ts
 * @module modules/projetos
 *
 * Serviço de tarefas do Kanban (3 colunas fixas). Criação, edição, listagem
 * agrupada por coluna e movimentação entre colunas. Movimentação publica evento
 * no outbox (que o notifier converte em notificações).
 */

import type { PoolClient } from "pg";
import { DomainError, ErrorCode } from "../../core/errors.js";
import { log as auditLog } from "../../core/audit/audit-logger.js";
import { publish, buildEnvelope } from "../../core/events/event-bus.js";
import { assertNotArchived } from "./project-service.js";

/** Colunas fixas do Kanban. */
export type TaskStatus = "nao_iniciada" | "em_execucao" | "finalizada";

/** Tarefa como persistida em `mod_projetos.tasks`. */
export interface Task {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  position: number;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
}

const COLUMNS = "id, project_id, title, description, status, position, created_by, created_at, updated_at";

/**
 * Cria uma tarefa na coluna `nao_iniciada`, ao fim da coluna. Bloqueia se o
 * projeto estiver arquivado. Audita.
 *
 * @param client - Cliente PostgreSQL.
 * @param input - `projectId`, `title`, `description`.
 * @param actorUserId - Autor.
 * @returns A tarefa criada.
 */
export async function createTask(
  client: PoolClient,
  input: { projectId: string; title: string; description?: string | undefined },
  actorUserId: string | null = null,
): Promise<Task> {
  await assertNotArchived(client, input.projectId);
  const { rows: posRows } = await client.query<{ next: number }>(
    `SELECT COALESCE(MAX(position) + 1, 0) AS next
     FROM mod_projetos.tasks WHERE project_id = $1 AND status = 'nao_iniciada'`,
    [input.projectId],
  );
  const position = posRows[0]?.next ?? 0;
  const { rows } = await client.query<Task>(
    `INSERT INTO mod_projetos.tasks (project_id, title, description, status, position, created_by)
     VALUES ($1, $2, $3, 'nao_iniciada', $4, $5)
     RETURNING ${COLUMNS}`,
    [input.projectId, input.title, input.description ?? null, position, actorUserId],
  );
  const task = rows[0] as Task;
  await auditLog(client, {
    userId: actorUserId,
    module: "projetos",
    action: "PROJ_TAREFA_CRIADA",
    payloadAfter: { task_id: task.id, project_id: input.projectId },
  });
  return task;
}

/**
 * Edita título/descrição de uma tarefa. Audita.
 *
 * @param client - Cliente PostgreSQL.
 * @param taskId - `id` da tarefa.
 * @param patch - Campos a alterar.
 * @param actorUserId - Autor.
 * @returns A tarefa atualizada, ou `null` se não existe.
 */
export async function updateTask(
  client: PoolClient,
  taskId: string,
  patch: { title?: string; description?: string | null },
  actorUserId: string | null = null,
): Promise<Task | null> {
  const { rows } = await client.query<Task>(
    `UPDATE mod_projetos.tasks SET
       title = COALESCE($2, title),
       description = COALESCE($3, description),
       updated_at = now()
     WHERE id = $1 RETURNING ${COLUMNS}`,
    [taskId, patch.title ?? null, patch.description ?? null],
  );
  const task = rows[0] ?? null;
  if (task) {
    await auditLog(client, {
      userId: actorUserId, module: "projetos", action: "PROJ_TAREFA_EDITADA",
      payloadAfter: { task_id: taskId },
    });
  }
  return task;
}

/**
 * Retorna uma tarefa pelo id.
 *
 * @param client - Cliente PostgreSQL.
 * @param taskId - `id` da tarefa.
 * @returns A tarefa, ou `null` se não existe.
 */
export async function getTask(client: PoolClient, taskId: string): Promise<Task | null> {
  const { rows } = await client.query<Task>(
    `SELECT ${COLUMNS} FROM mod_projetos.tasks WHERE id = $1`,
    [taskId],
  );
  return rows[0] ?? null;
}

/**
 * Lista as tarefas de um projeto ordenadas por coluna e posição (para montar o
 * Kanban).
 *
 * @param client - Cliente PostgreSQL.
 * @param projectId - `id` do projeto.
 * @returns As tarefas do projeto.
 */
export async function listTasksByProject(client: PoolClient, projectId: string): Promise<Task[]> {
  const { rows } = await client.query<Task>(
    `SELECT ${COLUMNS} FROM mod_projetos.tasks
     WHERE project_id = $1
     ORDER BY status, position, created_at`,
    [projectId],
  );
  return rows;
}

/**
 * Move uma tarefa para outra coluna (e posição). Bloqueia se o projeto estiver
 * arquivado. Audita e publica `projetos.tarefa.movida` no outbox.
 *
 * @param client - Cliente PostgreSQL.
 * @param taskId - `id` da tarefa.
 * @param toStatus - Coluna de destino.
 * @param toPosition - Posição de destino (default: fim da coluna).
 * @param actorUserId - Autor da movimentação.
 * @returns A tarefa atualizada.
 * @throws {DomainError} `PROJ_TASK_NOT_FOUND` se a tarefa não existe.
 */
export async function moveTask(
  client: PoolClient,
  taskId: string,
  toStatus: TaskStatus,
  toPosition: number | undefined,
  actorUserId: string | null = null,
): Promise<Task> {
  const current = await getTask(client, taskId);
  if (!current) {
    throw new DomainError(ErrorCode.PROJ_TASK_NOT_FOUND, "Tarefa não encontrada.", { task_id: taskId });
  }
  await assertNotArchived(client, current.project_id);

  let position = toPosition;
  if (position === undefined) {
    const { rows } = await client.query<{ next: number }>(
      `SELECT COALESCE(MAX(position) + 1, 0) AS next
       FROM mod_projetos.tasks WHERE project_id = $1 AND status = $2`,
      [current.project_id, toStatus],
    );
    position = rows[0]?.next ?? 0;
  }

  const { rows } = await client.query<Task>(
    `UPDATE mod_projetos.tasks SET status = $2, position = $3, updated_at = now()
     WHERE id = $1 RETURNING ${COLUMNS}`,
    [taskId, toStatus, position],
  );
  const task = rows[0] as Task;

  await auditLog(client, {
    userId: actorUserId,
    module: "projetos",
    action: "PROJ_TAREFA_MOVIDA",
    payloadBefore: { status: current.status },
    payloadAfter: { task_id: taskId, status: toStatus },
  });
  await publish(
    client,
    buildEnvelope("projetos.tarefa.movida", "mod_projetos", {
      task_id: taskId,
      project_id: current.project_id,
      from: current.status,
      to: toStatus,
      actor_user_id: actorUserId,
    }),
  );
  return task;
}
