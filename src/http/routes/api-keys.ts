/**
 * @file api-keys.ts
 * @module http/routes
 *
 * Rotas de administração de chaves de API (integrações externas) e a API
 * EXTERNA propriamente dita, autenticada por chave de API.
 *
 * Administração (`/api/iam/api-keys/*`): exclusiva do SuperAdministrador. Permite
 * criar (o segredo é exibido uma única vez), listar, revogar e definir as
 * permissões (namespaces RBAC) de cada chave — o análogo de "usuário de sistema".
 *
 * API externa (`/api/external/*`): autenticada por chave de API (header
 * `Authorization: Bearer <segredo>` ou `X-API-Key: <segredo>`) e autorizada pelos
 * namespaces concedidos à chave. Ex.: uma landing page enviando leads ao CRM com
 * dados de rastreamento em campos personalizados de contato.
 */

import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { withTransaction } from "../../core/db/pool.js";
import { DomainError, ErrorCode } from "../../core/errors.js";
import { isSuperadmin } from "../../core/iam/rbac.js";
import {
  createApiKey, listApiKeys, revokeApiKey, setApiKeyPermissions, authorizeApiKey,
} from "../../core/iam/api-key-service.js";
import { API_NAMESPACES } from "../../core/iam/namespaces.js";
import { createLead } from "../../modules/crm/lead-service.js";
import {
  listCustomFieldDefs, setCustomFieldValue,
} from "../../core/contacts/custom-field-service.js";

/**
 * Exige SuperAdministrador para administrar chaves de API.
 *
 * @param client - Cliente PostgreSQL.
 * @param userId - `user_id` autenticado.
 * @throws {DomainError} `AUTH_UNAUTHORIZED`/`RBAC_ACCESS_DENIED`.
 */
async function requireSuperadmin(client: import("pg").PoolClient, userId: string | null): Promise<void> {
  if (!userId) {
    throw new DomainError(ErrorCode.AUTH_UNAUTHORIZED, "Requisição não autenticada.", {});
  }
  if (!(await isSuperadmin(client, userId))) {
    throw new DomainError(ErrorCode.RBAC_ACCESS_DENIED, "Apenas o SuperAdministrador administra chaves de API.", {});
  }
}

/**
 * Registra as rotas de administração de chaves de API.
 *
 * @param app - Instância Fastify.
 * @param pool - Pool de conexões.
 */
export function registerApiKeyRoutes(app: FastifyInstance, pool: Pool): void {
  // Catálogo de namespaces concedíveis a chaves de API (para a UI).
  app.get("/api/iam/api-keys/namespaces", async (request, reply) => {
    await withTransaction(pool, (c) => requireSuperadmin(c, request.userId));
    return reply.send({ namespaces: API_NAMESPACES });
  });

  // Listar chaves de API (com permissões; sem segredos).
  app.get("/api/iam/api-keys", async (request, reply) => {
    const keys = await withTransaction(pool, async (c) => {
      await requireSuperadmin(c, request.userId);
      return listApiKeys(c);
    });
    return reply.send(keys);
  });

  // Criar chave de API. Retorna o segredo em claro UMA única vez.
  app.post<{ Body: { name: string } }>("/api/iam/api-keys", async (request, reply) => {
    const result = await withTransaction(pool, async (c) => {
      await requireSuperadmin(c, request.userId);
      return createApiKey(c, request.body?.name ?? "", request.userId);
    });
    // `secret` só é retornado aqui; nunca mais é recuperável.
    return reply.status(201).send({ ...result.key, secret: result.secret });
  });

  // Definir as permissões (namespaces) de uma chave.
  app.put<{ Params: { id: string }; Body: { permissions: string[] } }>(
    "/api/iam/api-keys/:id/permissions",
    async (request, reply) => {
      await withTransaction(pool, async (c) => {
        await requireSuperadmin(c, request.userId);
        await setApiKeyPermissions(c, request.params.id, request.body?.permissions ?? []);
      });
      return reply.status(204).send();
    },
  );

  // Revogar chave.
  app.post<{ Params: { id: string } }>("/api/iam/api-keys/:id/revoke", async (request, reply) => {
    await withTransaction(pool, async (c) => {
      await requireSuperadmin(c, request.userId);
      await revokeApiKey(c, request.params.id);
    });
    return reply.status(204).send();
  });
}

/** Corpo aceito pela ingestão de lead da API externa. */
interface IngestLeadBody {
  /** Dados da pessoa (obrigatório: nome, e-mail, telefone). */
  person: { full_name: string; email: string; phone: string };
  /** Dados da empresa (opcional). */
  company?: { legal_name: string; fiscal_document: string };
  /** Etapa inicial do pipeline (opcional). */
  column_id?: string;
  /**
   * Dados de rastreamento e outros campos personalizados de CONTATO, mapeados
   * por NOME do campo personalizado (ex.: utm_source, utm_campaign, landing_url).
   * Campos inexistentes são ignorados; campos com tipo incompatível são
   * rejeitados pelo serviço de campos personalizados.
   */
  tracking?: Record<string, unknown>;
}

/**
 * Registra a API EXTERNA (autenticada por chave de API).
 *
 * @param app - Instância Fastify.
 * @param pool - Pool de conexões.
 */
export function registerExternalApiRoutes(app: FastifyInstance, pool: Pool): void {
  // Ingestão de lead a partir de uma landing page (ou outro sistema externo).
  // Cria o lead no CRM (find-or-create de contatos) e grava os dados de
  // rastreamento como campos personalizados da PESSOA.
  app.post<{ Body: IngestLeadBody }>("/api/external/crm/leads", async (request, reply) => {
    const body = request.body;
    if (!body?.person?.full_name || !body?.person?.email || !body?.person?.phone) {
      throw new DomainError(
        ErrorCode.API_INGEST_INVALID,
        "Informe person.full_name, person.email e person.phone.",
        {},
      );
    }

    const result = await withTransaction(pool, async (c) => {
      // Autoriza a CHAVE de API (não usuário) pelo namespace de ingestão.
      await authorizeApiKey(c, request.apiKeyId, "api:crm:ingest_lead");

      const lead = await createLead(
        c,
        {
          person: body.person,
          ...(body.company ? { company: body.company } : {}),
          ...(body.column_id ? { columnId: body.column_id } : {}),
        },
        null, // ator = SYSTEM (integração)
      );

      // Grava os dados de rastreamento como campos personalizados de contato,
      // resolvendo o field_id pelo NOME. Ignora nomes desconhecidos.
      const applied: string[] = [];
      const ignored: string[] = [];
      const tracking = body.tracking ?? {};
      if (Object.keys(tracking).length > 0) {
        const defs = await listCustomFieldDefs(c, "contact");
        const byName = new Map(defs.map((d) => [d.name.toLowerCase(), d]));
        for (const [rawName, value] of Object.entries(tracking)) {
          const def = byName.get(rawName.toLowerCase());
          if (!def) {
            ignored.push(rawName);
            continue;
          }
          // Coerção leniente para texto: dados de tracking são strings na maioria.
          const coerced = def.data_type === "text" && typeof value !== "string" ? String(value) : value;
          await setCustomFieldValue(c, lead.person_contact_id, def.id, coerced);
          applied.push(def.name);
        }
      }

      return { lead_id: lead.id, person_contact_id: lead.person_contact_id, applied_fields: applied, ignored_fields: ignored };
    });

    return reply.status(201).send(result);
  });
}
