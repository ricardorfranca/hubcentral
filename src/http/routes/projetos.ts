/**
 * @file projetos.ts
 * @module http/routes
 *
 * Rotas do Módulo de Projetos Internos. Toda rota exige sessão (Bearer) e aplica
 * o namespace RBAC correspondente; rotas ligadas a um projeto também exigem a
 * regra de participação (`assertProjectAccess`).
 */

import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { withTransaction } from "../../core/db/pool.js";
import { authorize } from "../../core/iam/rbac.js";
import {
  createProject, updateProject, archiveProject, listProjectsForUser, getProject,
  assertProjectAccess, assertNotArchived,
} from "../../modules/projetos/project-service.js";
import { addMember, removeMember, listMembers } from "../../modules/projetos/member-service.js";
import {
  createTask, updateTask, getTask, listTasksByProject, moveTask, type TaskStatus,
} from "../../modules/projetos/task-service.js";
import { assign, unassign, listAssignees } from "../../modules/projetos/assignment-service.js";
import { addTaskComment, addProjectComment, listTaskComments } from "../../modules/projetos/comment-service.js";
import {
  saveAttachment, listAttachments, getAttachment, attachmentPath, deleteAttachment,
} from "../../modules/projetos/attachment-service.js";
import { createReadStream } from "node:fs";

/**
 * Registra as rotas do Módulo de Projetos Internos.
 *
 * @param app - Instância Fastify.
 * @param pool - Pool de conexões.
 */
export function registerProjetosRoutes(app: FastifyInstance, pool: Pool): void {
  // --- Projetos ---
  app.get("/api/projetos", async (request, reply) => {
    const list = await withTransaction(pool, async (c) => {
      await authorize(c, request.userId, "projetos:projeto:visualizar");
      return listProjectsForUser(c, request.userId!);
    });
    return reply.send(list);
  });

  app.post<{ Body: { name: string; description?: string; detail?: string; owner_user_id?: string } }>(
    "/api/projetos",
    async (request, reply) => {
      const b = request.body;
      const project = await withTransaction(pool, async (c) => {
        await authorize(c, request.userId, "projetos:projeto:criar");
        return createProject(c, { name: b.name, description: b.description, detail: b.detail, ownerUserId: b.owner_user_id }, request.userId);
      });
      return reply.status(201).send(project);
    },
  );

  app.get<{ Params: { id: string } }>("/api/projetos/:id", async (request, reply) => {
    const project = await withTransaction(pool, async (c) => {
      await authorize(c, request.userId, "projetos:projeto:visualizar");
      return getProject(c, request.params.id, request.userId!);
    });
    return reply.send(project);
  });

  app.patch<{ Params: { id: string }; Body: { name?: string; description?: string; detail?: string; owner_user_id?: string } }>(
    "/api/projetos/:id",
    async (request, reply) => {
      const b = request.body;
      const project = await withTransaction(pool, async (c) => {
        await authorize(c, request.userId, "projetos:projeto:editar");
        await assertProjectAccess(c, request.userId, request.params.id);
        const patch: { name?: string; description?: string | null; detail?: string | null; ownerUserId?: string } = {};
        if (b.name !== undefined) patch.name = b.name;
        if (b.description !== undefined) patch.description = b.description;
        if (b.detail !== undefined) patch.detail = b.detail;
        if (b.owner_user_id !== undefined) patch.ownerUserId = b.owner_user_id;
        return updateProject(c, request.params.id, patch, request.userId);
      });
      return reply.send(project);
    },
  );

  app.post<{ Params: { id: string } }>("/api/projetos/:id/archive", async (request, reply) => {
    const project = await withTransaction(pool, async (c) => {
      await authorize(c, request.userId, "projetos:projeto:arquivar");
      await assertProjectAccess(c, request.userId, request.params.id);
      return archiveProject(c, request.params.id, request.userId);
    });
    return reply.send(project);
  });

  // Diretório de usuários para seleção de membros/atribuídos (id, nome, e-mail).
  // Gated por gerenciar membros, já que expõe a lista de colaboradores.
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
      return listTasksByProject(c, request.params.id);
    });
    return reply.send(tasks);
  });

  app.post<{ Params: { id: string }; Body: { title: string; description?: string } }>(
    "/api/projetos/:id/tasks",
    async (request, reply) => {
      const task = await withTransaction(pool, async (c) => {
        await authorize(c, request.userId, "projetos:tarefa:criar");
        await assertProjectAccess(c, request.userId, request.params.id);
        await assertNotArchived(c, request.params.id);
        return createTask(c, { projectId: request.params.id, title: request.body.title, description: request.body.description }, request.userId);
      });
      return reply.status(201).send(task);
    },
  );

  app.get<{ Params: { taskId: string } }>("/api/projetos/tasks/:taskId", async (request, reply) => {
    const data = await withTransaction(pool, async (c) => {
      await authorize(c, request.userId, "projetos:tarefa:visualizar");
      const task = await getTask(c, request.params.taskId);
      if (!task) return null;
      await assertProjectAccess(c, request.userId, task.project_id);
      const [assignees, comments] = await Promise.all([
        listAssignees(c, task.id),
        listTaskComments(c, task.id),
      ]);
      const attachments = await listAttachments(c, task.id);
      return { ...task, assignees, comments, attachments };
    });
    if (!data) {
      return reply.status(404).send({ code: "PROJ_TASK_NOT_FOUND", message: "Tarefa não encontrada.", details: {} });
    }
    return reply.send(data);
  });

  app.patch<{ Params: { taskId: string }; Body: { title?: string; description?: string } }>(
    "/api/projetos/tasks/:taskId",
    async (request, reply) => {
      const task = await withTransaction(pool, async (c) => {
        await authorize(c, request.userId, "projetos:tarefa:editar");
        const current = await getTask(c, request.params.taskId);
        if (!current) return null;
        await assertProjectAccess(c, request.userId, current.project_id);
        const patch: { title?: string; description?: string | null } = {};
        if (request.body.title !== undefined) patch.title = request.body.title;
        if (request.body.description !== undefined) patch.description = request.body.description;
        return updateTask(c, request.params.taskId, patch, request.userId);
      });
      if (!task) {
        return reply.status(404).send({ code: "PROJ_TASK_NOT_FOUND", message: "Tarefa não encontrada.", details: {} });
      }
      return reply.send(task);
    },
  );

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

  // --- Atribuições ---
  app.post<{ Params: { taskId: string }; Body: { user_id: string } }>(
    "/api/projetos/tasks/:taskId/assignees",
    async (request, reply) => {
      await withTransaction(pool, async (c) => {
        await authorize(c, request.userId, "projetos:tarefa:atribuir");
        const task = await getTask(c, request.params.taskId);
        if (task) await assertProjectAccess(c, request.userId, task.project_id);
        return assign(c, request.params.taskId, request.body.user_id, request.userId);
      });
      return reply.status(204).send();
    },
  );

  app.delete<{ Params: { taskId: string; userId: string } }>(
    "/api/projetos/tasks/:taskId/assignees/:userId",
    async (request, reply) => {
      await withTransaction(pool, async (c) => {
        await authorize(c, request.userId, "projetos:tarefa:atribuir");
        const task = await getTask(c, request.params.taskId);
        if (task) await assertProjectAccess(c, request.userId, task.project_id);
        return unassign(c, request.params.taskId, request.params.userId, request.userId);
      });
      return reply.status(204).send();
    },
  );

  // --- Comentários de tarefa ---
  app.post<{ Params: { taskId: string }; Body: { body: string } }>(
    "/api/projetos/tasks/:taskId/comments",
    async (request, reply) => {
      const comment = await withTransaction(pool, async (c) => {
        await authorize(c, request.userId, "projetos:comentario:criar");
        const task = await getTask(c, request.params.taskId);
        if (task) await assertProjectAccess(c, request.userId, task.project_id);
        return addTaskComment(c, request.params.taskId, request.userId!, request.body.body);
      });
      return reply.status(201).send(comment);
    },
  );

  // --- Anexos ---
  app.post<{ Params: { taskId: string } }>("/api/projetos/tasks/:taskId/attachments", async (request, reply) => {
    // Lê o arquivo do multipart antes de abrir a transação.
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
