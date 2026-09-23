/**
 * @file deadline-worker.ts
 * @module core/notifications
 *
 * Worker periódico que varre os prazos dos módulos e gera alertas in-app na
 * Central de Notificações (o sino). Segue o mesmo padrão do outbox worker e do
 * worker de campanhas: ciclos não se sobrepõem e um erro em um ciclo não
 * derruba o worker. A geração é idempotente (ver {@link scanDeadlines}), então
 * rodar com frequência não duplica avisos.
 */

import type { Pool } from "pg";
import { scanDeadlines } from "./deadline-service.js";

/** Controle de um worker de prazos em execução. */
export interface DeadlineWorker {
  /** Interrompe o worker. */
  stop: () => void;
}

/**
 * Inicia o worker de varredura de prazos.
 *
 * @param pool - Pool de conexões.
 * @param options - `intervalMs` (default 5 min; valores inválidos caem no
 *   default) e `onError` opcional.
 * @returns Um {@link DeadlineWorker} com `stop()`.
 */
export function startDeadlineWorker(
  pool: Pool,
  options: { intervalMs?: number; onError?: (err: unknown) => void } = {},
): DeadlineWorker {
  // Blinda contra valores inválidos vindos de env (NaN, zero, negativos).
  const requested = options.intervalMs;
  const intervalMs = typeof requested === "number" && Number.isFinite(requested) && requested > 0
    ? requested
    : 5 * 60_000;
  let running = false;
  let stopped = false;

  const tick = async (): Promise<void> => {
    if (running || stopped) return;
    running = true;
    try {
      await scanDeadlines(pool);
    } catch (err) {
      options.onError?.(err);
    } finally {
      running = false;
    }
  };

  // Primeiro ciclo logo no boot, para não esperar o intervalo inicial.
  void tick();
  const handle = setInterval(() => void tick(), intervalMs);
  handle.unref?.();

  return {
    stop: () => {
      stopped = true;
      clearInterval(handle);
    },
  };
}
