import { describe, it, expect, afterAll, beforeEach } from "vitest";
import fc from "fast-check";
import { getTestPool, withRollback, closeTestPool } from "../helpers/db.js";
import { createContact, updateContact } from "../../src/core/contacts/contact-service.js";
import {
  isValidEventName,
  buildEnvelope,
  publish,
  subscribe,
  clearSubscriptions,
  dispatchPending,
} from "../../src/core/events/event-bus.js";

/**
 * @file event-bus.test.ts
 *
 * Testes do barramento de eventos (Tarefa 10). Cobre P27 (formato do nome de
 * evento), P28 (evento de contato carrega apenas a referência) e P29
 * (alteração de contato publica exatamente um core.contato.atualizado).
 */

const RUNS = { numRuns: 100 } as const;

beforeEach(async () => {
  clearSubscriptions();
  // Limpa o outbox para isolar as contagens de despacho entre casos.
  await getTestPool().query(`DELETE FROM core.event_outbox`);
});

afterAll(async () => {
  await getTestPool().query(`DELETE FROM core.event_outbox`);
  await closeTestPool();
});

describe("Barramento de eventos", () => {
  // Feature: central-contacts-and-module-contract, Property 27: Formato do nome
  // de evento — todo nome publicado está em [modulo].[recurso].[acao].
  it("Property 27: valida o formato [modulo].[recurso].[acao]", async () => {
    await fc.assert(
      fc.property(
        fc.tuple(
          fc.stringMatching(/^[a-z0-9_]+$/),
          fc.stringMatching(/^[a-z0-9_]+$/),
          fc.stringMatching(/^[a-z0-9_]+$/),
        ),
        ([m, r, a]) => {
          const name = `${m}.${r}.${a}`;
          expect(isValidEventName(name)).toBe(true);
        },
      ),
      RUNS,
    );

    // Nomes com número de segmentos diferente de 3 são inválidos.
    expect(isValidEventName("modulo.recurso")).toBe(false);
    expect(isValidEventName("a.b.c.d")).toBe(false);
    expect(isValidEventName("semponto")).toBe(false);
    expect(() => buildEnvelope("invalido", "core", {})).toThrow();
  });

  // Feature: central-contacts-and-module-contract, Property 28: Evento de
  // contato carrega apenas a referência — payload tem contact_id e nenhum dado
  // de contato.
  it("Property 28: evento de contato carrega apenas contact_id", async () => {
    await fc.assert(
      fc.asyncProperty(fc.uuid(), async (contactId) => {
        const env = buildEnvelope("core.contato.atualizado", "core", { contact_id: contactId });
        expect(Object.keys(env.payload)).toEqual(["contact_id"]);
        expect(env.payload.contact_id).toBe(contactId);
        // Nenhuma chave de dado de contato presente.
        for (const forbidden of ["name", "email", "phone", "full_name", "fiscal_document"]) {
          expect(env.payload).not.toHaveProperty(forbidden);
        }
      }),
      RUNS,
    );
  });

  // Feature: central-contacts-and-module-contract, Property 29: Alteração de
  // contato publica exatamente um core.contato.atualizado com o contact_id.
  it("Property 29: updateContact publica exatamente um core.contato.atualizado", async () => {
    // Cria um contato (committed) para poder atualizar e despachar.
    const pool = getTestPool();
    const email = `evt-${Math.random().toString(36).slice(2)}@example.com`;
    const created = await createContactCommitted(email);

    // Limpa o outbox (o createContact não publica evento; garante base limpa).
    await pool.query(`DELETE FROM core.event_outbox`);

    // Atualiza dentro de uma transação committed.
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await updateContact(client, created, { phone: "11888887777" });
      await client.query("COMMIT");
    } finally {
      client.release();
    }

    // Exatamente um evento core.contato.atualizado no outbox com o contact_id.
    const { rows } = await pool.query<{ event_name: string; envelope: { payload: { contact_id: string } } }>(
      `SELECT event_name, envelope FROM core.event_outbox WHERE event_name = 'core.contato.atualizado'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.envelope.payload.contact_id).toBe(created);

    // Despacho entrega ao assinante casado por padrão curinga.
    const received: string[] = [];
    subscribe("core.contato.*", (env) => {
      received.push(env.event_name);
    });
    const dispatched = await dispatchPending(pool);
    expect(dispatched).toBeGreaterThanOrEqual(1);
    expect(received).toContain("core.contato.atualizado");

    // Limpa o contato de teste.
    await pool.query(`DELETE FROM core.event_outbox`);
    await pool.query(`DELETE FROM core.contacts WHERE id = $1`, [created]);
  });

  it("exemplo: publish grava no outbox na transação corrente", async () => {
    await withRollback(async (client) => {
      const env = buildEnvelope("core.contato.atualizado", "core", { contact_id: "x" });
      const id = await publish(client, env);
      const { rows } = await client.query<{ status: string }>(
        `SELECT status FROM core.event_outbox WHERE id = $1`,
        [id],
      );
      expect(rows[0]?.status).toBe("pending");
    });
  });
});

/** Cria um contato committed (fora de rollback) e retorna seu id. */
async function createContactCommitted(email: string): Promise<string> {
  const pool = getTestPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const c = await createContact(client, {
      contact_type: "pessoa",
      full_name: "Evt Person",
      email,
      phone: "11999990000",
    });
    await client.query("COMMIT");
    return c.id;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
