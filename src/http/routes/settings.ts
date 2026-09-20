/**
 * @file settings.ts
 * @module http/routes
 *
 * Rotas da Central de Configurações do HUB Central (núcleo). Exigem o namespace
 * administrativo `core:config:gerenciar`. Lista os parâmetros (agrupáveis por
 * módulo na UI) e permite alterar valores.
 */

import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { withTransaction } from "../../core/db/pool.js";
import { authorize } from "../../core/iam/rbac.js";
import { listSettings, setSetting } from "../../core/settings/settings-service.js";

/** Permissão exigida para gerenciar configurações. */
const CONFIG_NS = "core:config:gerenciar";

/**
 * Registra as rotas da Central de Configurações.
 *
 * @param app - Instância Fastify.
 * @param pool - Pool de conexões.
 */
export function registerSettingsRoutes(app: FastifyInstance, pool: Pool): void {
  // Lista as configurações (opcionalmente filtradas por módulo).
  app.get<{ Querystring: { module?: string } }>("/api/settings", async (request, reply) => {
    const items = await withTransaction(pool, async (c) => {
      await authorize(c, request.userId, CONFIG_NS);
      return listSettings(c, request.query.module ? { module: request.query.module } : {});
    });
    return reply.send(items);
  });

  // Atualiza o valor de um parâmetro (value = null volta ao default).
  app.patch<{ Params: { key: string }; Body: { value: string | null } }>(
    "/api/settings/:key",
    async (request, reply) => {
      const updated = await withTransaction(pool, async (c) => {
        await authorize(c, request.userId, CONFIG_NS);
        return setSetting(c, request.params.key, request.body.value ?? null, request.userId);
      });
      return reply.send(updated);
    },
  );
}
