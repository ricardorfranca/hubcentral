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
import { registerImportExportRoutes } from "./routes/import-export.js";
import { registerCommsRoutes } from "./routes/comms.js";
import { registerApiKeyRoutes, registerExternalApiRoutes } from "./routes/api-keys.js";
import { validateSession } from "../core/iam/session-service.js";
import { resolveApiKey } from "../core/iam/api-key-service.js";

/** Extensão do request com o principal autenticado (usuário ou chave de API). */
declare module "fastify" {
  interface FastifyRequest {
    /** `user_id` autenticado (sessão de usuário), ou `null`. */
    userId: string | null;
    /** `id` da chave de API autenticada (integração externa), ou `null`. */
    apiKeyId: string | null;
  }
}

/** Extrai o segredo Bearer (ou X-API-Key) da requisição, ou `null`. */
function extractToken(request: FastifyRequest): string | null {
  const authorization = request.headers.authorization;
  const match = authorization ? /^Bearer\s+(.+)$/i.exec(authorization) : null;
  if (match) return match[1]!;
  const apiKeyHeader = request.headers["x-api-key"];
  if (typeof apiKeyHeader === "string" && apiKeyHeader.trim() !== "") return apiKeyHeader.trim();
  return null;
}

/**
 * Resolve o principal autenticado a partir do token. Primeiro tenta uma sessão
 * de usuário (IAM, `core.sessions`); se não for uma sessão válida, tenta uma
 * chave de API ativa (`core.api_keys`). Retorna qual principal foi resolvido.
 *
 * @param pool - Pool de conexões.
 * @param request - Requisição Fastify.
 * @returns `{ userId, apiKeyId }`, ambos possivelmente `null`.
 */
async function resolvePrincipal(
  pool: Pool,
  request: FastifyRequest,
): Promise<{ userId: string | null; apiKeyId: string | null }> {
  const token = extractToken(request);
  if (!token) return { userId: null, apiKeyId: null };
  const client = await pool.connect();
  try {
    try {
      const userId = await validateSession(client, token);
      return { userId, apiKeyId: null };
    } catch {
      // Não é uma sessão de usuário: tenta como chave de API.
    }
    const apiKeyId = await resolveApiKey(client, token);
    return { userId: null, apiKeyId };
  } catch {
    return { userId: null, apiKeyId: null };
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
  // O Assistente de Importação reenvia as linhas já parseadas como JSON na etapa
  // de execução; elevamos o limite de corpo para acomodar lotes grandes.
  const app = Fastify({
    logger: false,
    bodyLimit: Number(process.env.JSON_BODY_LIMIT_BYTES ?? 52_428_800), // 50 MiB
  });

  // Upload de anexos (multipart). O limite de tamanho efetivo é validado no
  // serviço a partir da Central de Configurações; aqui usamos um teto de guarda.
  void app.register(multipart, {
    limits: { fileSize: Number(process.env.UPLOADS_MAX_BYTES ?? 26_214_400) },
  });

  // Resolve o principal autenticado (usuário ou chave de API) antes de cada handler.
  app.decorateRequest("userId", null);
  app.decorateRequest("apiKeyId", null);
  app.addHook("preHandler", async (request) => {
    const { userId, apiKeyId } = await resolvePrincipal(pool, request);
    request.userId = userId;
    request.apiKeyId = apiKeyId;
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
  registerImportExportRoutes(app, pool);
  registerCommsRoutes(app, pool);
  registerProjetosRoutes(app, pool);
  registerApiKeyRoutes(app, pool);
  registerExternalApiRoutes(app, pool);

  return app;
}
