/**
 * @file app.ts
 * @module http
 *
 * Monta a aplicação HTTP (Fastify) do HUB Central: autenticação delegada ao
 * IAM, tratamento de erros de domínio e registro das rotas de contatos e CRM.
 */

import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import multipart from "@fastify/multipart";
import type { Pool } from "pg";
import { mapError } from "./error-mapping.js";
import { registerProjetosRoutes } from "./routes/projetos.js";
import { registerContactRoutes } from "./routes/contacts.js";
import { registerCrmRoutes } from "./routes/crm.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerUserRoutes } from "./routes/users.js";
import { registerCrmExtraRoutes, registerCrmMessagingRoutes } from "./routes/crm-extra.js";
import { registerCrmSalesRoutes } from "./routes/crm-sales.js";
import { registerNotificationRoutes } from "./routes/notifications.js";
import { registerSettingsRoutes } from "./routes/settings.js";
import { registerBackupRoutes } from "./routes/backup.js";
import { registerCommsRoutes } from "./routes/comms.js";
import { validateSession } from "../core/iam/session-service.js";

/** Extensão do request com o usuário autenticado. */
declare module "fastify" {
  interface FastifyRequest {
    /** `user_id` autenticado, ou `null` se não autenticado. */
    userId: string | null;
  }
}

/**
 * Resolve o `user_id` autenticado a partir do token Bearer da sessão (IAM).
 * A autenticação é delegada ao IAM: o token é validado em `core.sessions`
 * (não expirado nem revogado). Sem token válido, retorna `null`.
 *
 * @param pool - Pool de conexões.
 * @param request - Requisição Fastify.
 * @returns O `user_id` válido, ou `null`.
 */
async function resolveUser(pool: Pool, request: FastifyRequest): Promise<string | null> {
  const authorization = request.headers.authorization;
  const match = authorization ? /^Bearer\s+(.+)$/i.exec(authorization) : null;
  const token = match ? match[1]! : null;
  if (!token) {
    return null;
  }
  const client = await pool.connect();
  try {
    return await validateSession(client, token);
  } catch {
    // Token inválido/expirado/revogado -> não autenticado (rota decide 401).
    return null;
  } finally {
    client.release();
  }
}

/**
 * Cria a instância Fastify configurada com autenticação, tratamento de erros e
 * rotas. A instância não é iniciada (use `.listen`) — facilita testes com
 * `.inject`.
 *
 * @param pool - Pool de conexões PostgreSQL.
 * @returns A instância Fastify pronta.
 */
export function buildApp(pool: Pool): FastifyInstance {
  const app = Fastify({ logger: false });

  // Upload de anexos (multipart). O limite de tamanho efetivo é validado no
  // serviço a partir da Central de Configurações; aqui usamos um teto de guarda.
  void app.register(multipart, {
    limits: { fileSize: Number(process.env.UPLOADS_MAX_BYTES ?? 26_214_400) },
  });

  // Resolve o usuário autenticado antes de cada handler.
  app.decorateRequest("userId", null);
  app.addHook("preHandler", async (request) => {
    request.userId = await resolveUser(pool, request);
  });

  // Converte erros de domínio em respostas HTTP padronizadas.
  app.setErrorHandler((error, _request, reply) => {
    const { status, body } = mapError(error);
    void reply.status(status).send(body);
  });

  app.get("/health", async () => ({ status: "ok" }));

  registerAuthRoutes(app, pool);
  registerUserRoutes(app, pool);
  registerContactRoutes(app, pool);
  registerCrmRoutes(app, pool);
  registerCrmExtraRoutes(app, pool);
  registerCrmMessagingRoutes(app, pool);
  registerCrmSalesRoutes(app, pool);
  registerNotificationRoutes(app, pool);
  registerSettingsRoutes(app, pool);
  registerBackupRoutes(app, pool);
  registerCommsRoutes(app, pool);
  registerProjetosRoutes(app, pool);

  return app;
}
