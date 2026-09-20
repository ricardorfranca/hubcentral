/**
 * @file notifications.ts
 * @module http/routes
 *
 * Rotas da Central de Notificações in-app (núcleo). Cada usuário vê e gerencia
 * apenas as próprias notificações; basta estar autenticado.
 */

import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { withTransaction } from "../../core/db/pool.js";
import {
  listForUser, unreadCount, markRead, markAllRead,
} from "../../core/notifications/notification-service.js";

/**
 * Registra as rotas de notificações in-app.
 *
 * @param app - Instância Fastify.
 * @param pool - Pool de conexões.
 */
export function registerNotificationRoutes(app: FastifyInstance, pool: Pool): void {
  // Lista as notificações do usuário autenticado (?unread=1 para só não lidas).
  app.get<{ Querystring: { unread?: string } }>("/api/notifications", async (request, reply) => {
    if (!request.userId) {
      return reply.status(401).send({ code: "AUTH_UNAUTHORIZED", message: "Requisição não autenticada.", details: {} });
    }
    const unreadOnly = request.query.unread === "1" || request.query.unread === "true";
    const items = await withTransaction(pool, (c) => listForUser(c, request.userId!, { unreadOnly }));
    return reply.send(items);
  });

  // Contador de não lidas.
  app.get("/api/notifications/unread-count", async (request, reply) => {
    if (!request.userId) {
      return reply.status(401).send({ code: "AUTH_UNAUTHORIZED", message: "Requisição não autenticada.", details: {} });
    }
    const count = await withTransaction(pool, (c) => unreadCount(c, request.userId!));
    return reply.send({ count });
  });

  // Marca uma notificação como lida.
  app.post<{ Params: { id: string } }>("/api/notifications/:id/read", async (request, reply) => {
    if (!request.userId) {
      return reply.status(401).send({ code: "AUTH_UNAUTHORIZED", message: "Requisição não autenticada.", details: {} });
    }
    const updated = await withTransaction(pool, (c) => markRead(c, request.userId!, request.params.id));
    if (!updated) {
      return reply.status(404).send({ code: "NOTIFICATION_NOT_FOUND", message: "Notificação não encontrada.", details: {} });
    }
    return reply.send(updated);
  });

  // Marca todas as notificações do usuário como lidas.
  app.post("/api/notifications/read-all", async (request, reply) => {
    if (!request.userId) {
      return reply.status(401).send({ code: "AUTH_UNAUTHORIZED", message: "Requisição não autenticada.", details: {} });
    }
    const count = await withTransaction(pool, (c) => markAllRead(c, request.userId!));
    return reply.send({ marked: count });
  });
}
