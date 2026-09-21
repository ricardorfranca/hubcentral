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
  listUsers, listUserOptions, inviteUser, resendInvite, setUserRole, setUserStatus, setUserExtension,
  getUserById, setPassword,
  type UserRole,
} from "../../core/iam/identity-service.js";
import { authorize, listUserPermissions, setUserPermissions } from "../../core/iam/rbac.js";
import { ALL_NAMESPACES } from "../../core/iam/namespaces.js";
import { TEMP_PASSWORD } from "../../core/iam/identity-service.js";
import { sendEmail } from "../../core/email/email-service.js";

/** Permissão exigida para administrar usuários. */
const ADMIN_NS = "core:usuarios:gerenciar";

/**
 * Registra as rotas de administração de usuários.
 *
 * @param app - Instância Fastify.
 * @param pool - Pool de conexões.
 */
export function registerUserRoutes(app: FastifyInstance, pool: Pool): void {
  // Opções de usuários para seletores de responsável (ex.: gerente de contas de
  // uma empresa). Fora do grupo /api/iam porque NÃO é administração de usuários:
  // exige apenas a permissão de visualizar contatos e devolve somente
  // id/nome/e-mail dos usuários ativos, sem papel, status nem dados de senha.
  app.get("/api/users/options", async (request, reply) => {
    const options = await withTransaction(pool, async (c) => {
      await authorize(c, request.userId, "core:contatos:visualizar");
      return listUserOptions(c);
    });
    return reply.send(options);
  });

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
      // Envia o e-mail de convite (best-effort: não falha o convite se o SMTP
      // não estiver configurado ou indisponível).
      await withTransaction(pool, async (c) => {
        try {
          await sendEmail(c, {
            to: user.email,
            subject: "Convite para o HUB Central",
            text:
              `Olá, ${user.full_name}.\n\n` +
              `Você foi convidado para o HUB Central. Acesse o portal e use a senha temporária "${TEMP_PASSWORD}" ` +
              `no primeiro acesso para definir sua senha definitiva.\n`,
          });
        } catch {
          // SMTP não configurado/indisponível: convite segue válido.
        }
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

  // Alterar papel, status e/ou ramal.
  app.patch<{ Params: { id: string }; Body: { role?: UserRole; status?: "active" | "disabled"; extension?: string | null } }>(
    "/api/iam/users/:id",
    async (request, reply) => {
      const updated = await withTransaction(pool, async (c) => {
        await authorize(c, request.userId, ADMIN_NS);
        if (request.body.role) await setUserRole(c, request.params.id, request.body.role, request.userId);
        if (request.body.status) await setUserStatus(c, request.params.id, request.body.status, request.userId);
        if (request.body.extension !== undefined) await setUserExtension(c, request.params.id, request.body.extension, request.userId);
        return getUserById(c, request.params.id);
      });
      if (!updated) {
        return reply.status(404).send({ code: "IAM_USER_NOT_FOUND", message: "Usuário não encontrado.", details: {} });
      }
      return reply.send(updated);
    },
  );

  // Definir/atribuir a senha de um usuário diretamente (admin).
  app.post<{ Params: { id: string }; Body: { password: string } }>(
    "/api/iam/users/:id/password",
    async (request, reply) => {
      await withTransaction(pool, async (c) => {
        await authorize(c, request.userId, ADMIN_NS);
        await setPassword(c, request.params.id, request.body.password);
      });
      return reply.status(204).send();
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
