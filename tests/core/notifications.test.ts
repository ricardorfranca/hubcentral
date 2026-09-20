import { describe, it, expect, afterAll } from "vitest";
import type { PoolClient } from "pg";
import { withRollback, closeTestPool } from "../helpers/db.js";
import { randomUUID } from "node:crypto";
import {
  notify, listForUser, unreadCount, markRead, markAllRead,
} from "../../src/core/notifications/notification-service.js";

/**
 * @file notifications.test.ts
 *
 * Testes da Central de Notificações do núcleo (Fase 1): criação, listagem,
 * contagem de não lidas, marcar como lida e dedupe por source_event_id.
 */

afterAll(async () => {
  await closeTestPool();
});

let seq = 0;
async function newUser(client: PoolClient): Promise<string> {
  seq += 1;
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO core.users (email, full_name) VALUES ($1, 'U') RETURNING id`,
    [`notif${seq}-${Math.random().toString(36).slice(2)}@x.com`],
  );
  return rows[0]!.id;
}

describe("Central de Notificações", () => {
  it("cria, conta não lidas e marca como lida", async () => {
    await withRollback(async (client) => {
      const user = await newUser(client);

      await notify(client, { recipientUserId: user, module: "projetos", type: "projetos.tarefa.movida", message: "Tarefa movida" });
      await notify(client, { recipientUserId: user, module: "projetos", type: "projetos.comentario.criado", message: "Novo comentário" });

      expect(await unreadCount(client, user)).toBe(2);

      const list = await listForUser(client, user);
      expect(list).toHaveLength(2);

      const first = list[0]!;
      const read = await markRead(client, user, first.id);
      expect(read?.read).toBe(true);
      expect(await unreadCount(client, user)).toBe(1);

      // unreadOnly filtra as já lidas.
      expect(await listForUser(client, user, { unreadOnly: true })).toHaveLength(1);
    });
  });

  it("markAllRead zera o contador", async () => {
    await withRollback(async (client) => {
      const user = await newUser(client);
      await notify(client, { recipientUserId: user, module: "core", type: "x.y.z", message: "a" });
      await notify(client, { recipientUserId: user, module: "core", type: "x.y.z", message: "b" });
      const marked = await markAllRead(client, user);
      expect(marked).toBe(2);
      expect(await unreadCount(client, user)).toBe(0);
    });
  });

  it("deduplica por (source_event_id, destinatário)", async () => {
    await withRollback(async (client) => {
      const user = await newUser(client);
      const eventId = randomUUID();

      const a = await notify(client, {
        recipientUserId: user, module: "projetos", type: "projetos.tarefa.movida",
        message: "1", sourceEventId: eventId,
      });
      const b = await notify(client, {
        recipientUserId: user, module: "projetos", type: "projetos.tarefa.movida",
        message: "2 (reprocessado)", sourceEventId: eventId,
      });

      expect(a).not.toBeNull();
      expect(b).toBeNull(); // segunda inserção deduplicada
      expect(await unreadCount(client, user)).toBe(1);
    });
  });

  it("markRead só afeta notificações do próprio usuário", async () => {
    await withRollback(async (client) => {
      const owner = await newUser(client);
      const other = await newUser(client);
      const n = await notify(client, { recipientUserId: owner, module: "core", type: "x.y.z", message: "a" });
      const attempt = await markRead(client, other, n!.id);
      expect(attempt).toBeNull();
      expect(await unreadCount(client, owner)).toBe(1);
    });
  });
});
