import { describe, it, expect, afterAll } from "vitest";
import fc from "fast-check";
import type { PoolClient } from "pg";
import { withRollback, closeTestPool } from "../helpers/db.js";
import { createContact, mergeContacts } from "../../src/core/contacts/contact-service.js";
import { log as auditLog } from "../../src/core/audit/audit-logger.js";

/**
 * @file audit.test.ts
 *
 * Testes da auditoria centralizada e imutável (Tarefa 9). Cobre P30 (log
 * completo e correto por ação auditável) e P31 (imutabilidade: UPDATE/DELETE
 * falham).
 */

const RUNS = { numRuns: 50 } as const;

afterAll(async () => {
  await closeTestPool();
});

let seq = 0;
async function newPerson(client: PoolClient): Promise<string> {
  seq += 1;
  const c = await createContact(client, {
    contact_type: "pessoa",
    full_name: `Audit ${seq}`,
    email: `audit${seq}-${Math.random().toString(36).slice(2)}@example.com`,
    phone: "11999990000",
  });
  return c.id;
}

describe("Auditoria centralizada e imutável", () => {
  // Feature: central-contacts-and-module-contract, Property 30: Toda ação
  // auditável gera um log completo e correto — criar contato grava uma entrada
  // com todos os campos exigidos e coerente com a ação.
  it("Property 30: criar contato grava entrada CONTATO_CRIADO completa", async () => {
    await fc.assert(
      fc.asyncProperty(fc.constant(null), async () => {
        await withRollback(async (client) => {
          const before = await countLogs(client, "CONTATO_CRIADO");
          const contact = await createContact(client, {
            contact_type: "pessoa",
            full_name: "Audit PBT",
            email: `pbt-${Math.random().toString(36).slice(2)}@example.com`,
            phone: "11999990000",
          });
          const after = await countLogs(client, "CONTATO_CRIADO");
          expect(after).toBe(before + 1);

          const { rows } = await client.query<{
            id: string;
            timestamp: Date;
            module: string;
            action: string;
            payload_after: { id: string } | null;
          }>(
            `SELECT id, "timestamp", module, action, payload_after
             FROM core.system_logs
             WHERE action = 'CONTATO_CRIADO'
               AND payload_after->>'id' = $1`,
            [contact.id],
          );
          const entry = rows[0];
          expect(entry).toBeDefined();
          expect(entry?.module).toBe("core");
          expect(entry?.id).toMatch(/^[0-9a-f-]{36}$/i);
          expect(entry?.timestamp).toBeInstanceOf(Date);
          expect(entry?.payload_after?.id).toBe(contact.id);
        });
      }),
      RUNS,
    );
  });

  it("Property 30: mesclagem grava CONTATO_MESCLADO com origem e destino", async () => {
    await withRollback(async (client) => {
      const source = await newPerson(client);
      const target = await newPerson(client);
      await mergeContacts(client, source, target);

      const { rows } = await client.query<{
        payload_before: { source_id: string };
        payload_after: { target_id: string };
      }>(
        `SELECT payload_before, payload_after FROM core.system_logs
         WHERE action = 'CONTATO_MESCLADO'
           AND payload_before->>'source_id' = $1`,
        [source],
      );
      expect(rows[0]?.payload_before.source_id).toBe(source);
      expect(rows[0]?.payload_after.target_id).toBe(target);
    });
  });

  // Feature: central-contacts-and-module-contract, Property 31: Imutabilidade
  // do log de auditoria — qualquer UPDATE ou DELETE falha e a entrada permanece.
  it("Property 31: UPDATE e DELETE em system_logs falham", async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ maxLength: 20 }), async (newAction) => {
        await withRollback(async (client) => {
          const logId = await auditLog(client, {
            userId: null,
            module: "core",
            action: "TESTE_IMUTABILIDADE",
            payloadAfter: { k: 1 },
          });

          // Cada tentativa que falha aborta a transação; usamos SAVEPOINTs para
          // isolar as falhas e poder verificar o estado ao final.
          await client.query("SAVEPOINT s_update");
          await expect(
            client.query(`UPDATE core.system_logs SET action = $1 WHERE id = $2`, [newAction, logId]),
          ).rejects.toThrow();
          await client.query("ROLLBACK TO SAVEPOINT s_update");

          await client.query("SAVEPOINT s_delete");
          await expect(
            client.query(`DELETE FROM core.system_logs WHERE id = $1`, [logId]),
          ).rejects.toThrow();
          await client.query("ROLLBACK TO SAVEPOINT s_delete");

          // A entrada permanece inalterada.
          const { rows } = await client.query<{ action: string }>(
            `SELECT action FROM core.system_logs WHERE id = $1`,
            [logId],
          );
          expect(rows[0]?.action).toBe("TESTE_IMUTABILIDADE");
        });
      }),
      RUNS,
    );
  });
});

/** Conta entradas de log com uma dada action. */
async function countLogs(client: PoolClient, action: string): Promise<number> {
  const { rows } = await client.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM core.system_logs WHERE action = $1`,
    [action],
  );
  return Number(rows[0]?.count ?? "0");
}
