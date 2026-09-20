/**
 * @file schema-lint.ts
 * @module core/contract
 *
 * Lint de schema — verificação estática do Contrato de Módulos (Req 7.1, 7.2,
 * 9.1, 13.2, 14.1). Inspeciona as migrations dos schemas `mod_*` e reporta
 * violações: colunas de dados de contato copiados, tabela de usuários própria,
 * tabela de logs de auditoria própria, ou `mod_crm.leads` ainda com campos de
 * contato.
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

/** Uma violação de contrato encontrada em uma migration de módulo. */
export interface ContractViolation {
  file: string;
  rule: string;
  detail: string;
}

/**
 * Colunas de dados de contato proibidas em tabelas de módulo (Req 7.2).
 *
 * Inclui identificadores de PII inequívocos (`email`, `phone`, documentos) e as
 * formas específicas de nome de contato (`full_name`, `legal_name`,
 * `contact_name`, `contact_email`). NÃO inclui `name` isolado, que é ambíguo e
 * legítimo em tabelas de negócio (ex.: `campaigns.name`, `lists.name`).
 */
const CONTACT_DATA_COLUMNS = [
  "email",
  "phone",
  "fiscal_document",
  "cpf",
  "cnpj",
  "full_name",
  "legal_name",
  "contact_name",
  "contact_email",
  "contact_phone",
];

/**
 * Extrai o nome da tabela criada em um bloco CREATE TABLE de um schema mod_*.
 *
 * @param sql - SQL da migration (em minúsculas).
 * @returns Lista de nomes qualificados de tabelas criadas em mod_*.
 */
function findModCreateTables(sql: string): { qualified: string; body: string }[] {
  const results: { qualified: string; body: string }[] = [];
  const re = /create\s+table\s+(?:if\s+not\s+exists\s+)?(mod_[a-z0-9_]+\.[a-z0-9_]+)\s*\(([\s\S]*?)\)\s*;/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) {
    results.push({ qualified: m[1]!, body: m[2]! });
  }
  return results;
}

/**
 * Analisa o SQL de uma migration em busca de violações do contrato de módulos.
 *
 * @param file - Nome do arquivo (para o relatório).
 * @param rawSql - Conteúdo SQL da migration.
 * @returns Lista de violações encontradas.
 */
export function lintMigrationSql(file: string, rawSql: string): ContractViolation[] {
  const sql = rawSql.toLowerCase();
  const violations: ContractViolation[] = [];
  const tables = findModCreateTables(sql);

  for (const { qualified, body } of tables) {
    const [, tableName] = qualified.split(".");

    // Req 9.1: nenhum módulo mantém tabela própria de usuários.
    if (tableName === "users") {
      violations.push({
        file,
        rule: "no-module-users-table",
        detail: `Módulo não pode ter tabela própria de usuários: ${qualified} (Req 9.1).`,
      });
    }

    // Req 13.2: nenhum módulo grava logs de auditoria em tabela própria.
    if (tableName === "system_logs" || tableName === "audit_logs" || tableName === "logs") {
      violations.push({
        file,
        rule: "no-module-audit-table",
        detail: `Módulo não pode ter tabela de auditoria própria: ${qualified} (Req 13.2).`,
      });
    }

    // Req 7.1/7.2 e 14.1: nenhuma coluna de dado de contato copiada.
    // Considera cada definição de coluna (primeira palavra de cada item do corpo).
    const columnDefs = body
      .split(",")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    for (const def of columnDefs) {
      const colName = def.split(/\s+/)[0]?.replace(/["`]/g, "");
      if (colName && CONTACT_DATA_COLUMNS.includes(colName)) {
        violations.push({
          file,
          rule: "no-copied-contact-data",
          detail: `Coluna de dado de contato proibida '${colName}' em ${qualified} (Req 7.2/14.1). Use contact_id.`,
        });
      }
    }
  }

  return violations;
}

/**
 * Executa o lint sobre todas as migrations up.sql do diretório informado.
 *
 * @param migrationsDir - Diretório das migrations.
 * @returns Todas as violações encontradas (vazio = contrato respeitado).
 */
export async function lintMigrationsDirectory(migrationsDir: string): Promise<ContractViolation[]> {
  const files = await readdir(migrationsDir);
  const upFiles = files.filter((f) => f.endsWith(".up.sql") || (f.endsWith(".sql") && !f.endsWith(".down.sql")));
  const all: ContractViolation[] = [];
  for (const file of upFiles) {
    const content = await readFile(join(migrationsDir, file), "utf8");
    all.push(...lintMigrationSql(file, content));
  }
  return all;
}
