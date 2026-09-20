/**
 * @file comms.ts
 * @module http/routes
 *
 * Rotas de comunicação a partir do cadastro de contatos e configuração de
 * canais por usuário: envio de WhatsApp (Evolution API), SMS (gateway) e
 * discagem telefônica (curl ao PABX com o ramal do usuário). Também expõe a
 * gestão do canal de WhatsApp por usuário (o próprio usuário e o superadmin).
 */

import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { withTransaction } from "../../core/db/pool.js";
import { authorize } from "../../core/iam/rbac.js";
import {
  getUserChannel, upsertUserChannel, sendWhatsapp, verifyChannel,
} from "../../core/whatsapp/whatsapp-service.js";
import { sendSms } from "../../core/sms/sms-service.js";
import { dial } from "../../core/telephony/telephony-service.js";

/** Permissão para administrar usuários (superadmin/admin de módulo). */
const ADMIN_NS = "core:usuarios:gerenciar";

/**
 * Registra as rotas de comunicação e de canais por usuário.
 *
 * @param app - Instância Fastify.
 * @param pool - Pool de conexões.
 */
export function registerCommsRoutes(app: FastifyInstance, pool: Pool): void {
  // Lê o canal de WhatsApp do próprio usuário autenticado (sem expor a API key).
  app.get("/api/me/channel", async (request, reply) => {
    if (!request.userId) {
      return reply.status(401).send({ code: "AUTH_UNAUTHORIZED", message: "Requisição não autenticada.", details: {} });
    }
    const channel = await withTransaction(pool, (c) => getUserChannel(c, request.userId as string));
    return reply.send(sanitizeChannel(channel));
  });

  // Atualiza o canal de WhatsApp do próprio usuário.
  app.put<{ Body: ChannelBody }>("/api/me/channel", async (request, reply) => {
    if (!request.userId) {
      return reply.status(401).send({ code: "AUTH_UNAUTHORIZED", message: "Requisição não autenticada.", details: {} });
    }
    const saved = await withTransaction(pool, (c) =>
      upsertUserChannel(c, request.userId as string, toPatch(request.body), request.userId),
    );
    return reply.send(sanitizeChannel(saved));
  });

  // Superadmin: lê/insere o canal de qualquer usuário.
  app.get<{ Params: { id: string } }>("/api/iam/users/:id/channel", async (request, reply) => {
    const channel = await withTransaction(pool, async (c) => {
      await authorize(c, request.userId, ADMIN_NS);
      return getUserChannel(c, request.params.id);
    });
    return reply.send(sanitizeChannel(channel));
  });
  app.put<{ Params: { id: string }; Body: ChannelBody }>("/api/iam/users/:id/channel", async (request, reply) => {
    const saved = await withTransaction(pool, async (c) => {
      await authorize(c, request.userId, ADMIN_NS);
      return upsertUserChannel(c, request.params.id, toPatch(request.body), request.userId);
    });
    return reply.send(sanitizeChannel(saved));
  });

  // Testa o canal de WhatsApp do usuário autenticado.
  app.post("/api/me/channel/test", async (request, reply) => {
    if (!request.userId) {
      return reply.status(401).send({ code: "AUTH_UNAUTHORIZED", message: "Requisição não autenticada.", details: {} });
    }
    const result = await withTransaction(pool, (c) => verifyChannel(c, request.userId as string));
    return reply.send(result);
  });

  // Envia WhatsApp para um telefone, pelo canal do usuário autenticado.
  app.post<{ Body: { to: string; text: string } }>("/api/comms/whatsapp", async (request, reply) => {
    if (!request.userId) {
      return reply.status(401).send({ code: "AUTH_UNAUTHORIZED", message: "Requisição não autenticada.", details: {} });
    }
    await withTransaction(pool, (c) => sendWhatsapp(c, request.userId as string, request.body.to, request.body.text));
    return reply.status(204).send();
  });

  // Envia SMS para um telefone (gateway global).
  app.post<{ Body: { to: string; text: string } }>("/api/comms/sms", async (request, reply) => {
    if (!request.userId) {
      return reply.status(401).send({ code: "AUTH_UNAUTHORIZED", message: "Requisição não autenticada.", details: {} });
    }
    await withTransaction(pool, (c) => sendSms(c, request.body.to, request.body.text));
    return reply.status(204).send();
  });

  // Solicita discagem ao PABX: usa o ramal do usuário autenticado e o template
  // de curl configurado. O PABX retorna a chamada para o ramal informado.
  app.post<{ Body: { to: string; contact_name?: string } }>("/api/comms/call", async (request, reply) => {
    if (!request.userId) {
      return reply.status(401).send({ code: "AUTH_UNAUTHORIZED", message: "Requisição não autenticada.", details: {} });
    }
    await withTransaction(pool, async (c) => {
      const { rows } = await c.query<{ full_name: string; extension: string | null }>(
        `SELECT full_name, extension FROM core.users WHERE id = $1`,
        [request.userId],
      );
      const user = rows[0];
      await dial(c, {
        ramal: user?.extension ?? "",
        telefone: request.body.to,
        telefone_e164: "", // preenchido pelo serviço a partir de `telefone`
        usuario: user?.full_name ?? "",
        contato: request.body.contact_name ?? "",
      });
    });
    return reply.status(204).send();
  });
}

/** Corpo aceito ao salvar um canal de WhatsApp (interno). */
interface ChannelBody {
  wa_evolution_url?: string | null;
  wa_instance?: string | null;
  wa_api_key?: string | null;
  wa_enabled?: boolean;
}

/** Converte o corpo da requisição em patch do serviço (só chaves presentes). */
function toPatch(body: ChannelBody): ChannelBody {
  const patch: ChannelBody = {};
  if (body.wa_evolution_url !== undefined) patch.wa_evolution_url = body.wa_evolution_url;
  if (body.wa_instance !== undefined) patch.wa_instance = body.wa_instance;
  if (body.wa_api_key !== undefined) patch.wa_api_key = body.wa_api_key;
  if (body.wa_enabled !== undefined) patch.wa_enabled = body.wa_enabled;
  return patch;
}

/** Remove segredos (API key) da resposta e sinaliza se há chave definida. */
function sanitizeChannel(
  channel: { wa_evolution_url: string | null; wa_instance: string | null; wa_api_key: string | null; wa_enabled: boolean } | null,
): {
  wa_evolution_url: string | null;
  wa_instance: string | null;
  wa_api_key_set: boolean;
  wa_enabled: boolean;
} {
  return {
    wa_evolution_url: channel?.wa_evolution_url ?? null,
    wa_instance: channel?.wa_instance ?? null,
    wa_api_key_set: Boolean(channel?.wa_api_key),
    wa_enabled: channel?.wa_enabled ?? false,
  };
}
