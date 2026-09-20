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
  type ContactPatch,
} from "../../core/contacts/contact-service.js";
import type { ContactInput } from "../../core/contacts/types.js";
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
