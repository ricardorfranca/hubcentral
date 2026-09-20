/**
 * @file outbox-worker.ts
 * @module core/events
 *
 * Worker de despacho do transactional outbox. Executa {@link dispatchPending}
 * periodicamente, entregando os eventos publicados aos assinantes registrados
 * (fecha o ciclo do EDA sem broker externo).
 */

import type { Pool } from "pg";
import { dispatchPending } from "./event-bus.js";

/** Controle de um worker de outbox em execução. */
export interface OutboxWorker {
  /** Interrompe o worker (não despacha mais). */
  stop: () => void;
}

/**
 * Inicia um worker que despacha eventos pendentes do outbox a cada
 * `intervalMs`. Execuções não se sobrepõem: se um ciclo ainda roda, o próximo
 * é pulado. Erros de um ciclo são capturados e não derrubam o worker.
 *
 * @param pool - Pool de conexões.
 * @param options - Configuração opcional (`intervalMs`, default 1000; `batchSize`, default 100; `onError`).
 * @returns Um {@link OutboxWorker} com `stop()`.
 */
export function startOutboxWorker(
  pool: Pool,
  options: { intervalMs?: number; batchSize?: number; onError?: (err: unknown) => void } = {},
): OutboxWorker {
  const intervalMs = options.intervalMs ?? 1000;
  const batchSize = options.batchSize ?? 100;
  let running = false;
  let stopped = false;

  const tick = async (): Promise<void> => {
    if (running || stopped) {
      return;
    }
    running = true;
    try {
      await dispatchPending(pool, batchSize);
    } catch (err) {
      options.onError?.(err);
    } finally {
      running = false;
    }
  };

  const handle = setInterval(() => {
    void tick();
  }, intervalMs);
  // Não impede o processo de encerrar caso seja o único timer ativo.
  handle.unref?.();

  return {
    stop: () => {
      stopped = true;
      clearInterval(handle);
    },
  };
}
