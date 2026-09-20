/**
 * @file import-export-gateway.ts
 * @module core/io
 *
 * Import/Export Gateway (Req 11). Encapsula a verificação de permissão RBAC,
 * a (de)serialização de formatos e — na importação — a validação linha a linha
 * antes de persistir, retornando as linhas rejeitadas com o motivo. Toda
 * operação é auditada com o volume processado.
 */

import type { PoolClient } from "pg";
import { authorize } from "../iam/rbac.js";
import { log as auditLog } from "../audit/audit-logger.js";
import { serialize, parse, type IoFormat, type IoRecord } from "./formats.js";

/** Resultado da validação de uma linha de importação. */
export type RowValidation =
  | { ok: true; value: IoRecord }
  | { ok: false; reason: string };

/** Uma linha rejeitada na importação, com o índice (0-based) e o motivo. */
export interface RejectedRow {
  index: number;
  row: IoRecord;
  reason: string;
}

/** Resultado de uma importação. */
export interface ImportResult {
  imported: number;
  rejected: RejectedRow[];
}

/**
 * Exporta dados de um recurso de módulo no formato indicado, após verificar a
 * permissão `[modulo]:[recurso]:exportar` (Req 11.1, 11.3, 11.5, 11.7).
 *
 * @param client - Cliente PostgreSQL.
 * @param opts - Parâmetros da exportação.
 * @returns O conteúdo serializado.
 * @throws {DomainError} `AUTH_UNAUTHORIZED`/`RBAC_ACCESS_DENIED` conforme a permissão.
 */
export async function exportData(
  client: PoolClient,
  opts: {
    module: string;
    resource: string;
    format: IoFormat;
    userId: string | null;
    rows: readonly IoRecord[];
    columns?: readonly string[];
  },
): Promise<string> {
  await authorize(client, opts.userId, `${opts.module}:${opts.resource}:exportar`);
  const content = serialize(opts.format, opts.rows, opts.columns);

  await auditLog(client, {
    userId: opts.userId,
    module: opts.module,
    action: "EXPORTACAO_EXECUTADA",
    payloadAfter: { resource: opts.resource, format: opts.format, count: opts.rows.length },
  });

  return content;
}

/**
 * Importa dados para um recurso de módulo, após verificar a permissão
 * `[modulo]:[recurso]:importar` (Req 11.2, 11.4, 11.5). Valida CADA linha antes
 * de persistir: apenas as válidas são persistidas; as inválidas são retornadas
 * com o motivo (Req 11.6). Audita o volume processado (Req 11.7).
 *
 * @param client - Cliente PostgreSQL (em transação).
 * @param opts - Parâmetros da importação.
 * @returns Resultado com contagem de importadas e lista de rejeitadas.
 * @throws {DomainError} `AUTH_UNAUTHORIZED`/`RBAC_ACCESS_DENIED` conforme a permissão.
 */
export async function importData(
  client: PoolClient,
  opts: {
    module: string;
    resource: string;
    format: IoFormat;
    userId: string | null;
    content: string;
    /** Valida uma linha; retorna ok+valor normalizado ou motivo da rejeição. */
    validateRow: (row: IoRecord, index: number) => RowValidation;
    /** Persiste uma linha válida. */
    persistRow: (client: PoolClient, row: IoRecord) => Promise<void>;
  },
): Promise<ImportResult> {
  await authorize(client, opts.userId, `${opts.module}:${opts.resource}:importar`);

  const rows = parse(opts.format, opts.content);
  const rejected: RejectedRow[] = [];
  let imported = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const verdict = opts.validateRow(row, i);
    if (!verdict.ok) {
      rejected.push({ index: i, row, reason: verdict.reason });
      continue;
    }
    await opts.persistRow(client, verdict.value);
    imported++;
  }

  await auditLog(client, {
    userId: opts.userId,
    module: opts.module,
    action: "IMPORTACAO_EXECUTADA",
    payloadAfter: {
      resource: opts.resource,
      format: opts.format,
      imported,
      rejected: rejected.length,
    },
  });

  return { imported, rejected };
}
