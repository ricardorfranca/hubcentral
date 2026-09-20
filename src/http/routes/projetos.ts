/**
 * @file projetos.ts
 * @module http/routes
 *
 * Rotas do Módulo de Projetos Internos (2.0). Toda rota exige sessão (Bearer) e
 * aplica o namespace RBAC correspondente; rotas ligadas a um projeto também
 * exigem a regra de participação (`assertProjectAccess`). Inclui prazos,
 * dependências, responsável único, visibilidade, tempo/custos, desarquivar,
 * relatório PDF e dashboard.
 */

import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { withTransaction } from "../../core/db/pool.js";
import { authorize } from "../../core/iam/rbac.js";
import { DomainError, ErrorCode } from "../../core/errors.js";
import {
  createProject, updateProject, archiveProject, unarchiveProject, listProjectsForUser, getProject,
  assertProjectAccess, assertNotArchived, isSuperadminOrOwner, isSuperadmin,
  addResource, removeResource,
} from "../../modules/projetos/project-service.js";
import { addMember, removeMember, listMembers } from "../../modules/projetos/member-service.js";
import {
  createTask, updateTask, getTask, listTasksByProject, moveTask, type TaskStatus,
} from "../../modules/projetos/task-service.js";
import { setAssignee } from "../../modules/projetos/assignment-service.js";
import { addTaskComment, addProjectComment, listTaskComments } from "../../modules/projetos/comment-service.js";
import {
  saveAttachment, listAttachments, getAttachment, attachmentPath, deleteAttachment,
} from "../../modules/projetos/attachment-service.js";
import { generateProjectReport, projectsDashboard } from "../../modules/projetos/report-service.js";
import { createReadStream } from "node:fs";

/**
 * Registra as rotas do Módulo de Projetos Internos.
 *
 * @param app - Instância Fastify.
 * @param pool - Pool de conexões.
 */
export function registerProjetosRoutes(app: FastifyInstance, pool: Pool): void {
  // --- Dashboard do superadmin (antes das rotas com :id para não colidir) ---
  app.get("/api/projetos/dashboard", async (request, reply) => {
    const data = await withTransaction(pool, async (c) => {
      await authorize(c, request.userId, "projetos:projeto:visualizar");
      if (!(await isSuperadmin(c, request.userId))) {
        throw new DomainError(ErrorCode.RBAC_ACCESS_DENIED, "Apenas o SuperAdministrador acessa o dashboard.", {});
      }
      return projectsDashboard(c);
    });
    return reply.send(data);
  });

  // Diretório de usuários para seleção de membros/responsável.
  app.get("/api/projetos/users", async (request, reply) => {
    const users = await withTransaction(pool, async (c) => {
      await authorize(c, request.userId, "projetos:membros:gerenciar");
      const { rows } = await c.query<{ id: string; full_name: string | null; email: string }>(
        `SELECT id, full_name, email FROM core.users WHERE status = 'active' ORDER BY full_name`,
      );
      return rows;
    });
    return reply.send(users);
  });

  // --- Projetos ---
  app.get("/api/projetos", async (request, reply) => {
    const list = await withTransaction(pool, async (c) => {
      await authorize(c, request.userId, "projetos:projeto:visualizar");
      return listProjectsForUser(c, request.userId!);
    });
    return reply.send(list);
  });

  app.post<{
    Body: { name: string; description?: string; detail?: string; owner_user_id?: string; due_date?: string; hourly_rate?: number; warn_days?: number };
  }>("/api/projetos", async (request, reply) => {
    const b = request.body;
    const project = await withTransaction(pool, async (c) => {
      await authorize(c, request.userId, "projetos:projeto:criar");
      return createProject(c, {
        name: b.name, description: b.description, detail: b.detail, ownerUserId: b.owner_user_id,
        dueDate: b.due_date, hourlyRate: b.hourly_rate, warnDays: b.warn_days,
      }, request.userId);
    });
    return reply.status(201).send(project);
  });

  app.get<{ Params: { id: string } }>("/api/projetos/:id", async (request, reply) => {
    const project = await withTransaction(pool, async (c) => {
      await authorize(c, request.userId, "projetos:projeto:visualizar");
      return getProject(c, request.params.id, request.userId!);
    });
    return reply.send(project);
  });

  app.patch<{
    Params: { id: string };
    Body: { name?: string; description?: string; detail?: string; owner_user_id?: string; due_date?: string; hourly_rate?: number; warn_days?: number };
  }>("/api/projetos/:id", async (request, reply) => {
    const b = request.body;
    const project = await withTransaction(pool, async (c) => {
      await authorize(c, request.userId, "projetos:projeto:editar");
      await assertProjectAccess(c, request.userId, request.params.id);
      const patch: Parameters<typeof updateProject>[2] = {};
      if (b.name !== undefined) patch.name = b.name;
      if (b.description !== undefined) patch.description = b.description;
      if (b.detail !== undefined) patch.detail = b.detail;
      if (b.owner_user_id !== undefined) patch.ownerUserId = b.owner_user_id;
      if (b.due_date !== undefined) patch.dueDate = b.due_date;
      if (b.hourly_rate !== undefined) patch.hourlyRate = b.hourly_rate;
      if (b.warn_days !== undefined) patch.warnDays = b.warn_days;
      return updateProject(c, request.params.id, patch, request.userId);
    });
    return reply.send(project);
  });

  app.post<{ Params: { id: string } }>("/api/projetos/:id/archive", async (request, reply) => {
    const project = await withTransaction(pool, async (c) => {
      await authorize(c, request.userId, "projetos:projeto:arquivar");
      await assertProjectAccess(c, request.userId, request.params.id);
      return archiveProject(c, request.params.id, request.userId);
    });
    return reply.send(project);
  });

  // Desarquivar: apenas superadmin ou dono do projeto.
  app.post<{ Params: { id: string } }>("/api/projetos/:id/unarchive", async (request, reply) => {
    const project = await withTransaction(pool, async (c) => {
      await authorize(c, request.userId, "projetos:projeto:arquivar");
      if (!(await isSuperadminOrOwner(c, request.userId, request.params.id))) {
        throw new DomainError(ErrorCode.PROJ_ACCESS_DENIED, "Apenas o SuperAdministrador ou o dono podem desarquivar.", {});
      }
      return unarchiveProject(c, request.params.id, request.userId);
    });
    return reply.send(project);
  });

  // Relatório executivo em PDF: superadmin ou dono.
  app.get<{ Params: { id: string } }>("/api/projetos/:id/report", async (request, reply) => {
    const buffer = await withTransaction(pool, async (c) => {
      await authorize(c, request.userId, "projetos:projeto:visualizar");
      await assertProjectAccess(c, request.userId, request.params.id);
      if (!(await isSuperadminOrOwner(c, request.userId, request.params.id))) {
        throw new DomainError(ErrorCode.PROJ_ACCESS_DENIED, "Apenas o SuperAdministrador ou o dono podem emitir o relatório.", {});
      }
      return generateProjectReport(c, request.params.id, request.userId!);
    });
    void reply.header("Content-Type", "application/pdf");
    void reply.header("Content-Disposition", `attachment; filename="projeto-${request.params.id}.pdf"`);
    return reply.send(buffer);
  });

  // --- Recursos/custos ---
  app.post<{ Params: { id: string }; Body: { description: string; cost: number } }>(
    "/api/projetos/:id/resources",
    async (request, reply) => {
      const resource = await withTransaction(pool, async (c) => {
        await authorize(c, request.userId, "projetos:projeto:editar");
        await assertProjectAccess(c, request.userId, request.params.id);
        return addResource(c, request.params.id, { description: request.body.description, cost: request.body.cost }, request.userId);
      });
      return reply.status(201).send(resource);
    },
  );

  app.delete<{ Params: { id: string; resourceId: string } }>(
    "/api/projetos/:id/resources/:resourceId",
    async (request, reply) => {
      const removed = await withTransaction(pool, async (c) => {
        await authorize(c, request.userId, "projetos:projeto:editar");
        await assertProjectAccess(c, request.userId, request.params.id);
        return removeResource(c, request.params.resourceId);
      });
      if (!removed) return reply.status(404).send({ code: "PROJ_NOT_FOUND", message: "Recurso não encontrado.", details: {} });
      return reply.status(204).send();
    },
  );

  // --- Membros ---
  app.get<{ Params: { id: string } }>("/api/projetos/:id/members", async (request, reply) => {
    const members = await withTransaction(pool, async (c) => {
      await authorize(c, request.userId, "projetos:projeto:visualizar");
      await assertProjectAccess(c, request.userId, request.params.id);
      return listMembers(c, request.params.id);
    });
    return reply.send(members);
  });

  app.post<{ Params: { id: string }; Body: { user_id: string } }>(
    "/api/projetos/:id/members",
    async (request, reply) => {
      await withTransaction(pool, async (c) => {
        await authorize(c, request.userId, "projetos:membros:gerenciar");
        await assertProjectAccess(c, request.userId, request.params.id);
        return addMember(c, request.params.id, request.body.user_id, request.userId);
      });
      return reply.status(204).send();
    },
  );

  app.delete<{ Params: { id: string; userId: string } }>(
    "/api/projetos/:id/members/:userId",
    async (request, reply) => {
      await withTransaction(pool, async (c) => {
        await authorize(c, request.userId, "projetos:membros:gerenciar");
        await assertProjectAccess(c, request.userId, request.params.id);
        return removeMember(c, request.params.id, request.params.userId, request.userId);
      });
      return reply.status(204).send();
    },
  );

  // --- Comentários de projeto ---
  app.post<{ Params: { id: string }; Body: { body: string } }>(
    "/api/projetos/:id/comments",
    async (request, reply) => {
      const comment = await withTransaction(pool, async (c) => {
        await authorize(c, request.userId, "projetos:comentario:criar");
        await assertProjectAccess(c, request.userId, request.params.id);
        return addProjectComment(c, request.params.id, request.userId!, request.body.body);
      });
      return reply.status(201).send(comment);
    },
  );

  // --- Tarefas (Kanban) ---
  app.get<{ Params: { id: string } }>("/api/projetos/:id/tasks", async (request, reply) => {
    const tasks = await withTransaction(pool, async (c) => {
      await authorize(c, request.userId, "projetos:tarefa:visualizar");
      await assertProjectAccess(c, request.userId, request.params.id);
      return listTasksByProject(c, request.params.id, request.userId!);
    });
    return reply.send(tasks);
  });

  app.post<{
    Params: { id: string };
    Body: { title: string; description?: string; due_date?: string; assignee_user_id?: string; visible_to_all?: boolean; depends_on_task_id?: string; warn_days?: number };
  }>("/api/projetos/:id/tasks", async (request, reply) => {
    const b = request.body;
    const task = await withTransaction(pool, async (c) => {
      await authorize(c, request.userId, "projetos:tarefa:criar");
      await assertProjectAccess(c, request.userId, request.params.id);
      await assertNotArchived(c, request.params.id);
      return createTask(c, {
        projectId: request.params.id, title: b.title, description: b.description,
        dueDate: b.due_date, assigneeUserId: b.assignee_user_id, visibleToAll: b.visible_to_all,
        dependsOnTaskId: b.depends_on_task_id, warnDays: b.warn_days,
      }, request.userId);
    });
    return reply.status(201).send(task);
  });

  app.get<{ Params: { taskId: string } }>("/api/projetos/tasks/:taskId", async (request, reply) => {
    const data = await withTransaction(pool, async (c) => {
      await authorize(c, request.userId, "projetos:tarefa:visualizar");
      const task = await getTask(c, request.params.taskId);
      if (!task) return null;
      await assertProjectAccess(c, request.userId, task.project_id);
      const comments = await listTaskComments(c, task.id);
      const attachments = await listAttachments(c, task.id);
      const minutesTotal = comments.reduce((s, cm) => s + (cm.minutes ?? 0), 0);
      return { ...task, comments, attachments, minutes_total: minutesTotal };
    });
    if (!data) {
      return reply.status(404).send({ code: "PROJ_TASK_NOT_FOUND", message: "Tarefa não encontrada.", details: {} });
    }
    return reply.send(data);
  });

  app.patch<{
    Params: { taskId: string };
    Body: { title?: string; description?: string; due_date?: string; visible_to_all?: boolean; depends_on_task_id?: string | null; warn_days?: number };
  }>("/api/projetos/tasks/:taskId", async (request, reply) => {
    const b = request.body;
    const task = await withTransaction(pool, async (c) => {
      await authorize(c, request.userId, "projetos:tarefa:editar");
      const current = await getTask(c, request.params.taskId);
      if (!current) return null;
      await assertProjectAccess(c, request.userId, current.project_id);
      const patch: Parameters<typeof updateTask>[2] = {};
      if (b.title !== undefined) patch.title = b.title;
      if (b.description !== undefined) patch.description = b.description;
      if (b.due_date !== undefined) patch.dueDate = b.due_date;
      if (b.visible_to_all !== undefined) patch.visibleToAll = b.visible_to_all;
      if (b.depends_on_task_id !== undefined) patch.dependsOnTaskId = b.depends_on_task_id;
      if (b.warn_days !== undefined) patch.warnDays = b.warn_days;
      return updateTask(c, request.params.taskId, patch, request.userId);
    });
    if (!task) {
      return reply.status(404).send({ code: "PROJ_TASK_NOT_FOUND", message: "Tarefa não encontrada.", details: {} });
    }
    return reply.send(task);
  });

  app.patch<{ Params: { taskId: string }; Body: { status: TaskStatus; position?: number } }>(
    "/api/projetos/tasks/:taskId/move",
    async (request, reply) => {
      const task = await withTransaction(pool, async (c) => {
        await authorize(c, request.userId, "projetos:tarefa:mover");
        const current = await getTask(c, request.params.taskId);
        if (!current) return null;
        await assertProjectAccess(c, request.userId, current.project_id);
        return moveTask(c, request.params.taskId, request.body.status, request.body.position, request.userId);
      });
      if (!task) {
        return reply.status(404).send({ code: "PROJ_TASK_NOT_FOUND", message: "Tarefa não encontrada.", details: {} });
      }
      return reply.send(task);
    },
  );

  // --- Responsável único ---
  app.put<{ Params: { taskId: string }; Body: { user_id: string | null } }>(
    "/api/projetos/tasks/:taskId/assignee",
    async (request, reply) => {
      await withTransaction(pool, async (c) => {
        await authorize(c, request.userId, "projetos:tarefa:atribuir");
        const task = await getTask(c, request.params.taskId);
        if (task) await assertProjectAccess(c, request.userId, task.project_id);
        return setAssignee(c, request.params.taskId, request.body.user_id, request.userId);
      });
      return reply.status(204).send();
    },
  );

  // --- Comentários de tarefa (com apontamento de tempo) ---
  app.post<{ Params: { taskId: string }; Body: { body: string; minutes?: number } }>(
    "/api/projetos/tasks/:taskId/comments",
    async (request, reply) => {
      const comment = await withTransaction(pool, async (c) => {
        await authorize(c, request.userId, "projetos:comentario:criar");
        const task = await getTask(c, request.params.taskId);
        if (task) await assertProjectAccess(c, request.userId, task.project_id);
        return addTaskComment(c, request.params.taskId, request.userId!, request.body.body, request.body.minutes ?? 0);
      });
      return reply.status(201).send(comment);
    },
  );

  // --- Anexos ---
  app.post<{ Params: { taskId: string } }>("/api/projetos/tasks/:taskId/attachments", async (request, reply) => {
    const file = await request.file();
    if (!file) {
      return reply.status(400).send({ code: "PROJ_ATTACHMENT_INVALID", message: "Nenhum arquivo enviado.", details: {} });
    }
    const content = await file.toBuffer();
    const attachment = await withTransaction(pool, async (c) => {
      await authorize(c, request.userId, "projetos:anexo:enviar");
      const task = await getTask(c, request.params.taskId);
      if (!task) return null;
      await assertProjectAccess(c, request.userId, task.project_id);
      return saveAttachment(
        c,
        { taskId: task.id, projectId: task.project_id, originalName: file.filename, mimeType: file.mimetype, content },
        request.userId,
      );
    });
    if (!attachment) {
      return reply.status(404).send({ code: "PROJ_TASK_NOT_FOUND", message: "Tarefa não encontrada.", details: {} });
    }
    return reply.status(201).send(attachment);
  });

  app.get<{ Params: { id: string } }>("/api/projetos/attachments/:id", async (request, reply) => {
    const att = await withTransaction(pool, async (c) => {
      await authorize(c, request.userId, "projetos:anexo:baixar");
      const a = await getAttachment(c, request.params.id);
      if (!a) return null;
      await assertProjectAccess(c, request.userId, a.project_id);
      return a;
    });
    if (!att) {
      return reply.status(404).send({ code: "PROJ_ATTACHMENT_NOT_FOUND", message: "Anexo não encontrado.", details: {} });
    }
    void reply.header("Content-Type", att.mime_type ?? "application/octet-stream");
    void reply.header("Content-Disposition", `attachment; filename="${encodeURIComponent(att.original_name)}"`);
    return reply.send(createReadStream(attachmentPath(att)));
  });

  app.delete<{ Params: { id: string } }>("/api/projetos/attachments/:id", async (request, reply) => {
    const removed = await withTransaction(pool, async (c) => {
      await authorize(c, request.userId, "projetos:anexo:excluir");
      const a = await getAttachment(c, request.params.id);
      if (!a) return false;
      await assertProjectAccess(c, request.userId, a.project_id);
      return deleteAttachment(c, request.params.id, request.userId);
    });
    if (!removed) {
      return reply.status(404).send({ code: "PROJ_ATTACHMENT_NOT_FOUND", message: "Anexo não encontrado.", details: {} });
    }
    return reply.status(204).send();
  });
}
