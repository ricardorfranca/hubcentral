/**
 * @file event-bus.ts
 * @module core/events
 *
 * EventBus — barramento de eventos com transactional outbox (Req 12).
 * `publish` grava o evento em `core.event_outbox` na mesma transação da
 * mudança de dados; `dispatchPending` entrega aos assinantes e marca como
 * despachado (entrega ao menos uma vez). As assinaturas são registradas em
 * memória por padrão de nome de evento.
 */

import type { Pool, PoolClient } from "pg";
import { randomUUID } from "node:crypto";

/** Formato do nome de evento: `[modulo].[recurso].[acao]` (Req 12.2). */
export const EVENT_NAME_PATTERN = /^[a-z0-9_]+\.[a-z0-9_]+\.[a-z0-9_]+$/;

/** Envelope padronizado de evento (Req 12.3). */
export interface EventEnvelope {
  event_name: string;
  event_id: string;
  occurred_at: string;
  producer_module: string;
  payload: Record<string, unknown>;
  correlation_id?: string;
}

/** Handler de assinatura de evento. */
export type EventHandler = (envelope: EventEnvelope) => void | Promise<void>;

/**
 * Valida se um nome de evento segue o formato `[modulo].[recurso].[acao]`.
 *
 * @param name - Nome do evento.
 * @returns `true` se o nome é válido.
 */
export function isValidEventName(name: string): boolean {
  return EVENT_NAME_PATTERN.test(name);
}

/**
 * Cria um {@link EventEnvelope} padronizado.
 *
 * @param eventName - Nome do evento (`[modulo].[recurso].[acao]`).
 * @param producerModule - Módulo produtor (ex.: `core`, `mod_crm`).
 * @param payload - Dados do evento (para contatos, apenas `contact_id`).
 * @param correlationId - Id de correlação opcional.
 * @returns O envelope pronto para publicação.
 * @throws {Error} Se `eventName` não segue o formato exigido.
 */
export function buildEnvelope(
  eventName: string,
  producerModule: string,
  payload: Record<string, unknown>,
  correlationId?: string,
): EventEnvelope {
  if (!isValidEventName(eventName)) {
    throw new Error(`Nome de evento inválido: '${eventName}'. Use [modulo].[recurso].[acao].`);
  }
  const envelope: EventEnvelope = {
    event_name: eventName,
    event_id: randomUUID(),
    occurred_at: new Date().toISOString(),
    producer_module: producerModule,
    payload,
  };
  if (correlationId !== undefined) {
    envelope.correlation_id = correlationId;
  }
  return envelope;
}

/**
 * Publica um evento gravando-o no outbox na transação corrente (Req 12.1).
 * O evento fica `pending` até ser despachado.
 *
 * @param client - Cliente PostgreSQL (mesma transação da mudança de dados).
 * @param envelope - Envelope do evento a publicar.
 * @returns O `id` da linha do outbox.
 */
export async function publish(client: PoolClient, envelope: EventEnvelope): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO core.event_outbox (event_name, envelope)
     VALUES ($1, $2::jsonb) RETURNING id`,
    [envelope.event_name, JSON.stringify(envelope)],
  );
  return rows[0]!.id;
}

/** Registro em memória de assinaturas: padrão de nome de evento -> handlers. */
const subscriptions: { pattern: RegExp; raw: string; handler: EventHandler }[] = [];

/**
 * Converte um padrão de assinatura (com curinga `*` por segmento) em RegExp.
 * Ex.: `core.contato.*` casa `core.contato.atualizado`.
 *
 * @param pattern - Padrão de assinatura.
 * @returns RegExp equivalente.
 */
function patternToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .split(".")
    .map((seg) => (seg === "*" ? "[a-z0-9_]+" : seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
    .join("\\.");
  return new RegExp(`^${escaped}$`);
}

/**
 * Assina eventos que casam com um padrão (Req 12 — pub/sub).
 *
 * @param pattern - Padrão (ex.: `core.contato.*`).
 * @param handler - Função chamada para cada evento casado no despacho.
 */
export function subscribe(pattern: string, handler: EventHandler): void {
  subscriptions.push({ pattern: patternToRegExp(pattern), raw: pattern, handler });
}

/**
 * Remove todas as assinaturas (útil para isolamento de testes).
 */
export function clearSubscriptions(): void {
  subscriptions.length = 0;
}

/**
 * Despacha eventos pendentes do outbox aos assinantes e marca como
 * `dispatched` (entrega ao menos uma vez). Deve rodar após o COMMIT da
 * transação que publicou.
 *
 * @param pool - Pool de conexões.
 * @param limit - Máximo de eventos a despachar nesta rodada.
 * @returns Número de eventos despachados.
 */
export async function dispatchPending(pool: Pool, limit = 100): Promise<number> {
  const { rows } = await pool.query<{ id: string; envelope: EventEnvelope }>(
    `SELECT id, envelope FROM core.event_outbox
     WHERE status = 'pending' ORDER BY created_at LIMIT $1`,
    [limit],
  );

  for (const row of rows) {
    for (const sub of subscriptions) {
      if (sub.pattern.test(row.envelope.event_name)) {
        await sub.handler(row.envelope);
      }
    }
    await pool.query(
      `UPDATE core.event_outbox SET status = 'dispatched', dispatched_at = now() WHERE id = $1`,
      [row.id],
    );
  }
  return rows.length;
}
