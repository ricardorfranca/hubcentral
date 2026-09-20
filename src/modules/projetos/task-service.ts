/**
 * @file task-service.ts
 * @module modules/projetos
 *
 * Serviço de tarefas do Kanban (3 colunas fixas). Suporta prazo, responsável
 * único, visibilidade, dependência entre tarefas e apontamento de tempo. A
 * movimentação valida dependências, registra uma anotação automática e publica
 * evento no outbox (que o notifier converte em notificações).
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
  due_date: string | null;
  assignee_user_id: string | null;
  visible_to_all: boolean;
  warn_days: number | null;
  depends_on_task_id: string | null;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
}

/** Tarefa com minutos apontados somados. */
export interface TaskWithTime extends Task {
  minutes_total: number;
}

const COLUMNS =
  "id, project_id, title, description, status, position, due_date, assignee_user_id, visible_to_all, warn_days, depends_on_task_id, created_by, created_at, updated_at";

/** Rótulos legíveis das colunas (para a anotação automática). */
const STATUS_LABELS: Record<TaskStatus, string> = {
  nao_iniciada: "Não iniciadas",
  em_execucao: "Em execução",
  finalizada: "Finalizadas",
};

/**
 * Valida que o prazo da tarefa não ultrapassa o prazo do projeto.
 *
 * @param client - Cliente PostgreSQL.
 * @param projectId - `id` do projeto.
 * @param dueDate - Prazo da tarefa (ISO date), ou nulo.
 * @throws {DomainError} `PROJ_TASK_DUE_AFTER_PROJECT` se ultrapassar.
 */
async function assertDueWithinProject(
  client: PoolClient,
  projectId: string,
  dueDate: string | null | undefined,
): Promise<void> {
  if (!dueDate) return;
  // Compara no banco (evita divergência de tipo date x string entre driver/SO).
  const { rows } = await client.query<{ exceeds: boolean }>(
    `SELECT (due_date IS NOT NULL AND $2::date > due_date) AS exceeds
     FROM mod_projetos.projects WHERE id = $1`,
    [projectId, dueDate],
  );
  if (rows[0]?.exceeds) {
    throw new DomainError(ErrorCode.PROJ_TASK_DUE_AFTER_PROJECT, "O prazo da tarefa não pode ultrapassar o prazo do projeto.", {
      task_due: dueDate,
    });
  }
}

/**
 * Cria uma tarefa na coluna `nao_iniciada`, ao fim da coluna. Bloqueia se o
 * projeto estiver arquivado. Valida prazo e dependência. Audita.
 *
 * @param client - Cliente PostgreSQL.
 * @param input - Dados da tarefa.
 * @param actorUserId - Autor.
 * @returns A tarefa criada.
 */
export async function createTask(
  client: PoolClient,
  input: {
    projectId: string;
    title: string;
    description?: string | undefined;
    dueDate?: string | undefined;
    assigneeUserId?: string | undefined;
    visibleToAll?: boolean | undefined;
    dependsOnTaskId?: string | undefined;
    warnDays?: number | undefined;
  },
  actorUserId: string | null = null,
): Promise<Task> {
  await assertNotArchived(client, input.projectId);
  await assertDueWithinProject(client, input.projectId, input.dueDate);
  if (input.dependsOnTaskId) await assertValidDependency(client, input.projectId, input.dependsOnTaskId, null);

  const { rows: posRows } = await client.query<{ next: number }>(
    `SELECT COALESCE(MAX(position) + 1, 0) AS next
     FROM mod_projetos.tasks WHERE project_id = $1 AND status = 'nao_iniciada'`,
    [input.projectId],
  );
  const position = posRows[0]?.next ?? 0;
  const { rows } = await client.query<Task>(
    `INSERT INTO mod_projetos.tasks
       (project_id, title, description, status, position, due_date, assignee_user_id, visible_to_all, depends_on_task_id, warn_days, created_by)
     VALUES ($1, $2, $3, 'nao_iniciada', $4, $5, $6, COALESCE($7, true), $8, $9, $10)
     RETURNING ${COLUMNS}`,
    [
      input.projectId, input.title, input.description ?? null, position,
      input.dueDate ?? null, input.assigneeUserId ?? null, input.visibleToAll ?? null,
      input.dependsOnTaskId ?? null, input.warnDays ?? null, actorUserId,
    ],
  );
  const task = rows[0] as Task;
  await auditLog(client, {
    userId: actorUserId, module: "projetos", action: "PROJ_TAREFA_CRIADA",
    payloadAfter: { task_id: task.id, project_id: input.projectId },
  });
  return task;
}

/**
 * Edita campos de uma tarefa (título, descrição, prazo, responsável,
 * visibilidade, dependência, warn_days). Valida prazo e dependência. Audita.
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
  patch: {
    title?: string;
    description?: string | null;
    dueDate?: string | null;
    assigneeUserId?: string | null;
    visibleToAll?: boolean;
    dependsOnTaskId?: string | null;
    warnDays?: number | null;
  },
  actorUserId: string | null = null,
): Promise<Task | null> {
  const current = await getTask(client, taskId);
  if (!current) return null;
  if (patch.dueDate !== undefined && patch.dueDate !== null) {
    await assertDueWithinProject(client, current.project_id, patch.dueDate);
  }
  if (patch.dependsOnTaskId !== undefined && patch.dependsOnTaskId !== null) {
    await assertValidDependency(client, current.project_id, patch.dependsOnTaskId, taskId);
  }

  const { rows } = await client.query<Task>(
    `UPDATE mod_projetos.tasks SET
       title = COALESCE($2, title),
       description = COALESCE($3, description),
       due_date = COALESCE($4, due_date),
       assignee_user_id = COALESCE($5, assignee_user_id),
       visible_to_all = COALESCE($6, visible_to_all),
       depends_on_task_id = COALESCE($7, depends_on_task_id),
       warn_days = COALESCE($8, warn_days),
       updated_at = now()
     WHERE id = $1 RETURNING ${COLUMNS}`,
    [
      taskId, patch.title ?? null, patch.description ?? null, patch.dueDate ?? null,
      patch.assigneeUserId ?? null, patch.visibleToAll ?? null, patch.dependsOnTaskId ?? null,
      patch.warnDays ?? null,
    ],
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
 * Valida uma dependência: mesma raiz de projeto e sem auto-referência/ciclo
 * simples (a dependência não pode ser a própria tarefa nem depender de volta
 * desta).
 *
 * @param client - Cliente PostgreSQL.
 * @param projectId - `id` do projeto da tarefa.
 * @param dependsOnTaskId - `id` da tarefa-dependência.
 * @param taskId - `id` da tarefa (ou null na criação).
 * @throws {DomainError} `PROJ_DEPENDENCY_INVALID` em caso inválido.
 */
async function assertValidDependency(
  client: PoolClient,
  projectId: string,
  dependsOnTaskId: string,
  taskId: string | null,
): Promise<void> {
  if (taskId && dependsOnTaskId === taskId) {
    throw new DomainError(ErrorCode.PROJ_DEPENDENCY_INVALID, "Uma tarefa não pode depender de si mesma.", {});
  }
  const { rows } = await client.query<{ project_id: string; depends_on_task_id: string | null }>(
    `SELECT project_id, depends_on_task_id FROM mod_projetos.tasks WHERE id = $1`,
    [dependsOnTaskId],
  );
  const dep = rows[0];
  if (!dep || dep.project_id !== projectId) {
    throw new DomainError(ErrorCode.PROJ_DEPENDENCY_INVALID, "A dependência deve ser uma tarefa do mesmo projeto.", {});
  }
  // Evita ciclo direto A->B->A.
  if (taskId && dep.depends_on_task_id === taskId) {
    throw new DomainError(ErrorCode.PROJ_DEPENDENCY_INVALID, "Dependência circular não permitida.", {});
  }
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
 * Lista as tarefas de um projeto (ordenadas por coluna e posição) com o total
 * de minutos apontados por tarefa. Aplica a visibilidade: tarefas com
 * `visible_to_all = false` só aparecem para o dono do projeto e o responsável.
 *
 * @param client - Cliente PostgreSQL.
 * @param projectId - `id` do projeto.
 * @param viewerUserId - Usuário que está visualizando.
 * @returns As tarefas visíveis, com `minutes_total`.
 */
export async function listTasksByProject(
  client: PoolClient,
  projectId: string,
  viewerUserId: string,
): Promise<TaskWithTime[]> {
  const { rows } = await client.query<TaskWithTime>(
    `SELECT ${COLUMNS.split(", ").map((c) => `t.${c}`).join(", ")},
            COALESCE((SELECT SUM(minutes) FROM mod_projetos.task_comments tc WHERE tc.task_id = t.id), 0)::int AS minutes_total
     FROM mod_projetos.tasks t
     JOIN mod_projetos.projects p ON p.id = t.project_id
     WHERE t.project_id = $1
       AND (t.visible_to_all = true OR p.owner_user_id = $2 OR t.assignee_user_id = $2)
     ORDER BY t.status, t.position, t.created_at`,
    [projectId, viewerUserId],
  );
  return rows;
}

/**
 * Move uma tarefa para outra coluna (e posição). Bloqueia se o projeto estiver
 * arquivado e se a dependência não estiver finalizada (ao sair de
 * `nao_iniciada`). Registra uma anotação automática e publica
 * `projetos.tarefa.movida`.
 *
 * @param client - Cliente PostgreSQL.
 * @param taskId - `id` da tarefa.
 * @param toStatus - Coluna de destino.
 * @param toPosition - Posição de destino (default: fim da coluna).
 * @param actorUserId - Autor da movimentação.
 * @returns A tarefa atualizada.
 * @throws {DomainError} `PROJ_TASK_NOT_FOUND`/`PROJ_DEPENDENCY_NOT_DONE`.
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

  // Regra de dependência: para sair de "não iniciada" (iniciar/concluir), a
  // dependência precisa estar finalizada.
  if (current.status === "nao_iniciada" && toStatus !== "nao_iniciada" && current.depends_on_task_id) {
    const dep = await getTask(client, current.depends_on_task_id);
    if (dep && dep.status !== "finalizada") {
      throw new DomainError(ErrorCode.PROJ_DEPENDENCY_NOT_DONE, "A tarefa da qual esta depende ainda não foi finalizada.", {
        depends_on_task_id: current.depends_on_task_id,
      });
    }
  }

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

  // Anotação automática da mudança (com o responsável pela ação).
  if (current.status !== toStatus) {
    const authorName = await userName(client, actorUserId);
    await client.query(
      `INSERT INTO mod_projetos.task_comments (task_id, author_user_id, body, minutes)
       VALUES ($1, $2, $3, 0)`,
      [
        taskId,
        actorUserId,
        `${authorName} moveu a tarefa de "${STATUS_LABELS[current.status]}" para "${STATUS_LABELS[toStatus]}".`,
      ],
    );
  }

  await auditLog(client, {
    userId: actorUserId, module: "projetos", action: "PROJ_TAREFA_MOVIDA",
    payloadBefore: { status: current.status }, payloadAfter: { task_id: taskId, status: toStatus },
  });
  await publish(
    client,
    buildEnvelope("projetos.tarefa.movida", "mod_projetos", {
      task_id: taskId, project_id: current.project_id, from: current.status, to: toStatus, actor_user_id: actorUserId,
    }),
  );
  return task;
}

/** Retorna o nome (ou e-mail) de um usuário, para as anotações automáticas. */
async function userName(client: PoolClient, userId: string | null): Promise<string> {
  if (!userId) return "Sistema";
  const { rows } = await client.query<{ full_name: string | null; email: string }>(
    `SELECT full_name, email FROM core.users WHERE id = $1`,
    [userId],
  );
  return rows[0]?.full_name ?? rows[0]?.email ?? "Usuário";
}
