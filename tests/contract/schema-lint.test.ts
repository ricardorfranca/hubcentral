import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  lintMigrationSql,
  lintMigrationsDirectory,
} from "../../src/core/contract/schema-lint.js";

/**
 * @file schema-lint.test.ts
 *
 * Testes do lint de schema (Tarefa 14, verificação de contrato). Garante que
 * as migrations atuais respeitam o contrato e que cada regra proibida é
 * detectada (Req 7.1, 7.2, 9.1, 13.2, 14.1).
 */

const migrationsDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "migrations",
);

describe("Lint de schema (contrato de módulos)", () => {
  it("as migrations atuais do repositório respeitam o contrato", async () => {
    const violations = await lintMigrationsDirectory(migrationsDir);
    expect(violations).toEqual([]);
  });

  it("detecta coluna de dado de contato copiada em tabela de módulo (Req 7.2/14.1)", () => {
    const sql = `CREATE TABLE mod_crm.leads (
      id uuid PRIMARY KEY,
      full_name varchar(200),
      email citext,
      column_id varchar(50)
    );`;
    const v = lintMigrationSql("x.up.sql", sql);
    const rules = v.map((x) => x.rule);
    expect(rules).toContain("no-copied-contact-data");
    expect(v.some((x) => x.detail.includes("full_name"))).toBe(true);
    expect(v.some((x) => x.detail.includes("email"))).toBe(true);
  });

  it("detecta tabela de usuários própria de módulo (Req 9.1)", () => {
    const sql = `CREATE TABLE mod_crm.users (id uuid PRIMARY KEY, login text);`;
    const v = lintMigrationSql("x.up.sql", sql);
    expect(v.map((x) => x.rule)).toContain("no-module-users-table");
  });

  it("detecta tabela de auditoria própria de módulo (Req 13.2)", () => {
    const sql = `CREATE TABLE mod_crm.audit_logs (id uuid PRIMARY KEY, action text);`;
    const v = lintMigrationSql("x.up.sql", sql);
    expect(v.map((x) => x.rule)).toContain("no-module-audit-table");
  });

  it("não acusa colunas de contato em tabelas do schema core", () => {
    const sql = `CREATE TABLE core.contacts (id uuid PRIMARY KEY, email citext, name text);`;
    const v = lintMigrationSql("core.up.sql", sql);
    expect(v).toEqual([]);
  });

  it("aceita tabela de módulo que referencia contato por contact_id", () => {
    const sql = `CREATE TABLE mod_crm.leads (
      id uuid PRIMARY KEY,
      person_contact_id uuid REFERENCES core.contacts (id),
      company_contact_id uuid REFERENCES core.contacts (id),
      column_id varchar(50)
    );`;
    const v = lintMigrationSql("x.up.sql", sql);
    expect(v).toEqual([]);
  });
});
