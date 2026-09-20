/**
 * @file audit-logger.ts
 * @module core/audit
 *
 * AuditLogger — única porta de escrita em `core.system_logs` (Req 13). Grava
 * entradas imutáveis de auditoria. Nenhum módulo grava logs em tabela própria
 * (Req 13.2); toda auditoria passa por aqui.
 */

import type { PoolClient } from "pg";

/** UUID sentinela para o ator SYSTEM (ações automáticas). */
export const SYSTEM_ACTOR: null = null;

/**
 * Entrada de auditoria a gravar. `user_id` nulo representa o ator SYSTEM.
 */
export interface AuditEntry {
  /** Autor da ação (`user_id`), ou `null` para SYSTEM. */
  userId: string | null;
  /** Módulo responsável (`core` ou nome do módulo). */
  module: string;
  /** Ação auditada (ex.: `CONTATO_CRIADO`). */
  action: string;
  /** Estado anterior (para alterações), se aplicável. */
  payloadBefore?: unknown;
  /** Estado novo (para criações/alterações), se aplicável. */
  payloadAfter?: unknown;
  /** IP de origem, se disponível. */
  ipAddress?: string;
  /** User agent de origem, se disponível. */
  userAgent?: string;
}

/**
 * Grava uma entrada de auditoria em `core.system_logs` (Req 13.1, 13.3). O
 * `timestamp` é gerado em UTC pelo banco (`now()` em coluna TIMESTAMPTZ).
 *
 * @param client - Cliente PostgreSQL (idealmente na mesma transação da ação).
 * @param entry - Dados da entrada de auditoria.
 * @returns O `id` da entrada gravada.
 */
export async function log(client: PoolClient, entry: AuditEntry): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO core.system_logs
       (user_id, module, action, payload_before, payload_after, ip_address, user_agent)
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7)
     RETURNING id`,
    [
      entry.userId,
      entry.module,
      entry.action,
      entry.payloadBefore === undefined ? null : JSON.stringify(entry.payloadBefore),
      entry.payloadAfter === undefined ? null : JSON.stringify(entry.payloadAfter),
      entry.ipAddress ?? null,
      entry.userAgent ?? null,
    ],
  );
  return rows[0]!.id;
}
