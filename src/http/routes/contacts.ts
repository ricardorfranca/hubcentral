/**
 * @file contacts.ts
 * @module http/routes
 *
 * Rotas HTTP da Base Central de Contatos e de segmentos. Cada handler abre uma
 * transação e delega aos serviços do núcleo, injetando o `userId` autenticado.
 */

import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { withTransaction } from "../../core/db/pool.js";
import {
  createContact,
  getContactData,
  updateContact,
  deleteContact,
  listContacts,
  type ContactPatch,
} from "../../core/contacts/contact-service.js";
import type { ContactInput } from "../../core/contacts/types.js";
import {
  listCategories, createCustomCategory, assignCategory, unassignCategory,
} from "../../core/contacts/category-service.js";
import { lookupCnpj } from "../../core/contacts/cnpj-lookup.js";
import {
  createSegment,
  evaluateSegment,
  type SegmentCriteria,
} from "../../core/contacts/segment-service.js";

/**
 * Registra as rotas de contatos e segmentos na instância Fastify.
 *
 * @param app - Instância Fastify.
 * @param pool - Pool de conexões.
 */
export function registerContactRoutes(app: FastifyInstance, pool: Pool): void {
  // Listar contatos (com rótulos), filtrando por tipo e/ou texto.
  app.get<{ Querystring: { type?: "pessoa" | "empresa"; search?: string } }>(
    "/api/contacts",
    async (request, reply) => {
      const items = await withTransaction(pool, (client) =>
        listContacts(client, {
          type: request.query.type,
          search: request.query.search,
        }),
      );
      return reply.send(items);
    },
  );

  // Consulta de CNPJ para autofill de empresa (dados oficiais).
  app.get<{ Params: { cnpj: string } }>("/api/contacts/cnpj/:cnpj", async (request, reply) => {
    const data = await lookupCnpj(request.params.cnpj);
    if (!data) {
      return reply.status(404).send({ code: "CNPJ_NOT_FOUND", message: "CNPJ não encontrado ou serviço indisponível.", details: {} });
    }
    return reply.send(data);
  });

  // Categorias (rótulos): listar e criar.
  app.get("/api/contacts/categories", async (_request, reply) => {
    const categories = await withTransaction(pool, (client) => listCategories(client));
    return reply.send(categories);
  });
  app.post<{ Body: { name: string } }>("/api/contacts/categories", async (request, reply) => {
    const category = await withTransaction(pool, (client) => createCustomCategory(client, request.body.name));
    return reply.status(201).send(category);
  });

  // Atribuir/remover rótulo a um contato.
  app.post<{ Params: { id: string }; Body: { category_id: string } }>(
    "/api/contacts/:id/labels",
    async (request, reply) => {
      await withTransaction(pool, (client) => assignCategory(client, request.params.id, request.body.category_id));
      return reply.status(204).send();
    },
  );
  app.delete<{ Params: { id: string; categoryId: string } }>(
    "/api/contacts/:id/labels/:categoryId",
    async (request, reply) => {
      await withTransaction(pool, (client) => unassignCategory(client, request.params.id, request.params.categoryId));
      return reply.status(204).send();
    },
  );

  // Criar contato.
  app.post<{ Body: ContactInput }>("/api/contacts", async (request, reply) => {
    const contact = await withTransaction(pool, (client) =>
      createContact(client, request.body, request.userId),
    );
    return reply.status(201).send(contact);
  });

  // Obter contato por id.
  app.get<{ Params: { id: string } }>("/api/contacts/:id", async (request, reply) => {
    const contact = await withTransaction(pool, (client) =>
      getContactData(client, request.params.id),
    );
    if (!contact) {
      return reply.status(404).send({ code: "CONTACT_NOT_FOUND", message: "Contato não encontrado.", details: {} });
    }
    return reply.send(contact);
  });

  // Atualizar contato (publica core.contato.atualizado).
  app.patch<{ Params: { id: string }; Body: ContactPatch }>(
    "/api/contacts/:id",
    async (request, reply) => {
      const contact = await withTransaction(pool, (client) =>
        updateContact(client, request.params.id, request.body, request.userId),
      );
      return reply.send(contact);
    },
  );

  // Excluir contato (bloqueado se referenciado por módulos).
  app.delete<{ Params: { id: string } }>("/api/contacts/:id", async (request, reply) => {
    await withTransaction(pool, (client) => deleteContact(client, request.params.id));
    return reply.status(204).send();
  });

  // Criar segmento persistido.
  app.post<{ Body: { name: string; criteria: SegmentCriteria } }>(
    "/api/segments",
    async (request, reply) => {
      const userId = request.userId;
      if (!userId) {
        return reply.status(401).send({ code: "AUTH_UNAUTHORIZED", message: "Requisição não autenticada.", details: {} });
      }
      const segment = await withTransaction(pool, (client) =>
        createSegment(client, request.body.name, request.body.criteria, userId),
      );
      return reply.status(201).send(segment);
    },
  );

  // Avaliar critérios de segmento (retorna apenas contact_id).
  app.post<{ Body: SegmentCriteria }>("/api/segments/evaluate", async (request, reply) => {
    const ids = await withTransaction(pool, (client) => evaluateSegment(client, request.body));
    return reply.send({ contact_ids: ids });
  });
}
