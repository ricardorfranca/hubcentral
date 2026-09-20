import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { getTestPool, closeTestPool } from "../helpers/db.js";
import { buildEnvelope, publish, subscribe, clearSubscriptions } from "../../src/core/events/event-bus.js";
import { startOutboxWorker } from "../../src/core/events/outbox-worker.js";

/**
 * @file outbox-worker.test.ts
 *
 * Testes do worker de despacho do outbox: publica eventos e verifica que o
 * worker os entrega aos assinantes e os marca como despachados.
 */

beforeEach(async () => {
  clearSubscriptions();
  await getTestPool().query(`DELETE FROM core.event_outbox`);
});

afterAll(async () => {
  await getTestPool().query(`DELETE FROM core.event_outbox`);
  await closeTestPool();
});

/** Aguarda até `predicate` ser verdadeiro ou estourar o timeout. */
async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("timeout aguardando condição");
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe("Worker de despacho do outbox", () => {
  it("despacha eventos pendentes aos assinantes e marca como dispatched", async () => {
    const pool = getTestPool();
    const received: string[] = [];
    subscribe("core.contato.*", (env) => {
      received.push(env.payload.contact_id as string);
    });

    // Publica um evento committed.
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await publish(client, buildEnvelope("core.contato.atualizado", "core", { contact_id: "abc" }));
      await client.query("COMMIT");
    } finally {
      client.release();
    }

    const worker = startOutboxWorker(pool, { intervalMs: 50 });
    try {
      await waitFor(() => received.includes("abc"));
    } finally {
      worker.stop();
    }

    const { rows } = await pool.query<{ status: string }>(
      `SELECT status FROM core.event_outbox WHERE event_name = 'core.contato.atualizado'`,
    );
    expect(rows.every((r) => r.status === "dispatched")).toBe(true);
  });
});
