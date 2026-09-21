import { describe, it, expect, afterAll } from "vitest";
import type { PoolClient } from "pg";
import { withRollback, closeTestPool } from "../helpers/db.js";
import { createActivity, completeActivity, listMyActivities, listByOpportunity } from "../../src/modules/crm/activity-service.js";
import { sendMessage, listConversations, markRead, dmConversationId, GROUP_CONVERSATION } from "../../src/modules/crm/message-service.js";
import { createAccount } from "../../src/modules/crm/account-service.js";
import { createOpportunity } from "../../src/modules/crm/opportunity-service.js";
import { createContact } from "../../src/core/contacts/contact-service.js";

/**
 * @file activities-messaging.test.ts
 *
 * Testes da Fase 3: atividades (cadência) e correção da mensageria
 * (listConversations com não lidas, markRead).
 */

afterAll(async () => {
  await closeTestPool();
});

let seq = 0;
async function newUser(client: PoolClient): Promise<string> {
  seq += 1;
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO core.users (email, full_name) VALUES ($1, 'U') RETURNING id`,
    [`am${seq}-${Math.random().toString(36).slice(2)}@x.com`],
  );
  return rows[0]!.id;
}

/** Cria uma pessoa e retorna seu `contact_id` (contato principal da oportunidade). */
async function newPerson(client: PoolClient): Promise<string> {
  seq += 1;
  const person = await createContact(client, {
    contact_type: "pessoa",
    full_name: `Resp ${seq}`,
    email: `resp-am${seq}-${Math.random().toString(36).slice(2)}@x.com`,
    phone: "11999990000",
  });
  return person.id;
}

describe("Atividades", () => {
  it("cria, lista pendentes e conclui atividade", async () => {
    await withRollback(async (client) => {
      const user = await newUser(client);
      const acc = await createAccount(client, { legalName: "E", cnpj: String(30000000000000 + seq) });
      const primaryContactId = await newPerson(client);
      const opp = await createOpportunity(client, { accountId: acc.id, name: "Op", mrr: 100, primaryContactId });

      const act = await createActivity(client, {
        type: "ligacao", subject: "Ligar para decisor", opportunityId: opp.id, assignedTo: user,
      });
      expect(act.status).toBe("pendente");

      const mine = await listMyActivities(client, user);
      expect(mine.some((a) => a.id === act.id)).toBe(true);

      const done = await completeActivity(client, act.id);
      expect(done?.status).toBe("concluida");
      expect(done?.completed_at).not.toBeNull();

      // Após concluir, não aparece mais em pendentes.
      expect((await listMyActivities(client, user)).some((a) => a.id === act.id)).toBe(false);

      // Aparece no histórico da oportunidade.
      expect((await listByOpportunity(client, opp.id)).some((a) => a.id === act.id)).toBe(true);
    });
  });
});

describe("Mensageria (conversas e não lidas)", () => {
  it("lista o canal da equipe e conta não lidas até markRead", async () => {
    await withRollback(async (client) => {
      const me = await newUser(client);
      const other = await newUser(client);

      // 'other' manda 2 mensagens no canal group.
      await sendMessage(client, { fromUserId: other, conversationId: GROUP_CONVERSATION, text: "oi 1" });
      await sendMessage(client, { fromUserId: other, conversationId: GROUP_CONVERSATION, text: "oi 2" });

      let convs = await listConversations(client, me);
      const group = convs.find((c) => c.conversation_id === GROUP_CONVERSATION);
      expect(group).toBeDefined();
      expect(group?.unread).toBe(2);
      expect(group?.last_text).toBe("oi 2");

      // Após marcar lido, zera.
      await markRead(client, me, GROUP_CONVERSATION);
      convs = await listConversations(client, me);
      expect(convs.find((c) => c.conversation_id === GROUP_CONVERSATION)?.unread).toBe(0);
    });
  });

  it("inclui DMs em que o usuário participa", async () => {
    await withRollback(async (client) => {
      const me = await newUser(client);
      const other = await newUser(client);
      const dm = dmConversationId(me, other);
      await sendMessage(client, { fromUserId: other, conversationId: dm, text: "dm!" });

      const convs = await listConversations(client, me);
      const found = convs.find((c) => c.conversation_id === dm);
      expect(found).toBeDefined();
      expect(found?.unread).toBe(1);
    });
  });
});
