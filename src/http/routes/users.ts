/**
 * @file users.ts
 * @module http/routes
 *
 * Rotas de administração de usuários (IAM). Todas exigem a permissão
 * `core:usuarios:gerenciar` (SuperAdmin/Admin de Módulo).
 */

import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { withTransaction } from "../../core/db/pool.js";
import {
  listUsers, inviteUser, resendInvite, setUserRole, setUserStatus, getUserById,
  type UserRole,
} from "../../core/iam/identity-service.js";
import { authorize, listUserPermissions, setUserPermissions } from "../../core/iam/rbac.js";
import { ALL_NAMESPACES } from "../../core/iam/namespaces.js";

/** Permissão exigida para administrar usuários. */
const ADMIN_NS = "core:usuarios:gerenciar";

/**
 * Registra as rotas de administração de usuários.
 *
 * @param app - Instância Fastify.
 * @param pool - Pool de conexões.
 */
export function registerUserRoutes(app: FastifyInstance, pool: Pool): void {
  // Catálogo de namespaces disponíveis (para a UI montar o editor de permissões).
  app.get("/api/iam/namespaces", async (request, reply) => {
    await withTransaction(pool, (c) => authorize(c, request.userId, ADMIN_NS));
    return reply.send({ namespaces: ALL_NAMESPACES });
  });

  // Listar usuários.
  app.get("/api/iam/users", async (request, reply) => {
    const users = await withTransaction(pool, async (c) => {
      await authorize(c, request.userId, ADMIN_NS);
      return listUsers(c);
    });
    return reply.send(users);
  });

  // Convidar novo usuário.
  app.post<{ Body: { email: string; full_name: string; role: UserRole } }>(
    "/api/iam/users",
    async (request, reply) => {
      const user = await withTransaction(pool, async (c) => {
        await authorize(c, request.userId, ADMIN_NS);
        return inviteUser(c, request.body, request.userId);
      });
      return reply.status(201).send(user);
    },
  );

  // Reenviar convite (regenera senha temporária; respeita cooldown).
  app.post<{ Params: { id: string } }>("/api/iam/users/:id/resend", async (request, reply) => {
    await withTransaction(pool, async (c) => {
      await authorize(c, request.userId, ADMIN_NS);
      await resendInvite(c, request.params.id);
    });
    return reply.status(204).send();
  });

  // Alterar papel e/ou status.
  app.patch<{ Params: { id: string }; Body: { role?: UserRole; status?: "active" | "disabled" } }>(
    "/api/iam/users/:id",
    async (request, reply) => {
      const updated = await withTransaction(pool, async (c) => {
        await authorize(c, request.userId, ADMIN_NS);
        if (request.body.role) await setUserRole(c, request.params.id, request.body.role, request.userId);
        if (request.body.status) await setUserStatus(c, request.params.id, request.body.status, request.userId);
        return getUserById(c, request.params.id);
      });
      if (!updated) {
        return reply.status(404).send({ code: "IAM_USER_NOT_FOUND", message: "Usuário não encontrado.", details: {} });
      }
      return reply.send(updated);
    },
  );

  // Ler permissões RBAC de um usuário.
  app.get<{ Params: { id: string } }>("/api/iam/users/:id/permissions", async (request, reply) => {
    const permissions = await withTransaction(pool, async (c) => {
      await authorize(c, request.userId, ADMIN_NS);
      return listUserPermissions(c, request.params.id);
    });
    return reply.send({ permissions });
  });

  // Substituir o conjunto de permissões de um usuário.
  app.put<{ Params: { id: string }; Body: { permissions: string[] } }>(
    "/api/iam/users/:id/permissions",
    async (request, reply) => {
      await withTransaction(pool, async (c) => {
        await authorize(c, request.userId, ADMIN_NS);
        await setUserPermissions(c, request.params.id, request.body.permissions);
      });
      return reply.status(204).send();
    },
  );
}
