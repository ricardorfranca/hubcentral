import { describe, it, expect, afterAll } from "vitest";
import { getTestPool, withRollback, closeTestPool } from "./helpers/db.js";

/**
 * @file foundation.test.ts
 *
 * Teste smoke da fundação (Tarefa 1 do plano). Valida que:
 *  - o container Postgres subiu e as migrations base foram aplicadas;
 *  - os schemas `core` e `mod_crm` existem;
 *  - as extensões `pgcrypto` e `citext` estão instaladas;
 *  - as tabelas de fundação (`core.users`, `core.system_logs`) existem;
 *  - o helper de transação revertida (`withRollback`) isola os casos.
 */

afterAll(async () => {
  await closeTestPool();
});

describe("Fundação do HUB Central", () => {
  it("cria os schemas core e mod_crm", async () => {
    const { rows } = await getTestPool().query<{ schema_name: string }>(
      `SELECT schema_name FROM information_schema.schemata
       WHERE schema_name IN ('core', 'mod_crm') ORDER BY schema_name`,
    );
    expect(rows.map((r) => r.schema_name)).toEqual(["core", "mod_crm"]);
  });

  it("instala as extensões pgcrypto e citext", async () => {
    const { rows } = await getTestPool().query<{ extname: string }>(
      `SELECT extname FROM pg_extension
       WHERE extname IN ('pgcrypto', 'citext') ORDER BY extname`,
    );
    expect(rows.map((r) => r.extname)).toEqual(["citext", "pgcrypto"]);
  });

  it("cria as tabelas de fundação core.users e core.system_logs", async () => {
    const { rows } = await getTestPool().query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'core' AND table_name IN ('users', 'system_logs')
       ORDER BY table_name`,
    );
    expect(rows.map((r) => r.table_name)).toEqual(["system_logs", "users"]);
  });

  it("gera UUID via gen_random_uuid (pgcrypto) para core.users", async () => {
    const inserted = await withRollback(async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO core.users (email, full_name)
         VALUES ($1, $2) RETURNING id`,
        ["fundacao@example.com", "Usuário Fundação"],
      );
      return rows[0]?.id;
    });
    expect(inserted).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it("withRollback reverte as escritas entre casos", async () => {
    const { rows } = await getTestPool().query<{ count: string }>(
      `SELECT count(*)::text AS count FROM core.users WHERE email = $1`,
      ["fundacao@example.com"],
    );
    // O insert do caso anterior foi revertido: nenhum registro persiste.
    expect(rows[0]?.count).toBe("0");
  });
});
