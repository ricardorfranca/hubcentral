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

beforeEach(() => {
  // Apenas limpa assinaturas em memória; o teste usa nome de evento único e
  // verifica a própria linha por id, sem depender de um outbox vazio.
  clearSubscriptions();
});

afterAll(async () => {
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
    // Nome de evento ÚNICO deste teste, para não colidir com eventos publicados
    // por outros testes que compartilham o mesmo core.event_outbox e o mesmo
    // registro global de assinaturas. Torna o teste determinístico.
    const suffix = Math.random().toString(36).slice(2);
    const eventName = `teste.worker.${suffix}`;
    const marker = `abc-${suffix}`;
    const received: string[] = [];
    subscribe(`teste.worker.${suffix}`, (env) => {
      received.push(env.payload.contact_id as string);
    });

    // Publica um evento committed e guarda o id da linha do outbox.
    let outboxId = "";
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      outboxId = await publish(client, buildEnvelope(eventName, "core", { contact_id: marker }));
      await client.query("COMMIT");
    } finally {
      client.release();
    }

    const worker = startOutboxWorker(pool, { intervalMs: 50 });
    try {
      await waitFor(() => received.includes(marker));
    } finally {
      worker.stop();
    }

    // Verifica APENAS a linha publicada por este teste (por id), não um filtro
    // por nome de evento genérico.
    const { rows } = await pool.query<{ status: string }>(
      `SELECT status FROM core.event_outbox WHERE id = $1`,
      [outboxId],
    );
    expect(rows[0]?.status).toBe("dispatched");
  });
});
