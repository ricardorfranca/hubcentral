/**
 * @file campaign-worker.ts
 * @module modules/crm
 *
 * Worker de disparo automático de campanhas. Periodicamente busca as campanhas
 * com `auto_dispatch` ativas cujo horário agendado já chegou e processa um lote
 * de cada uma, respeitando `batch_size` e `per_hour`. Segue o mesmo padrão do
 * outbox worker: ciclos não se sobrepõem e erros não derrubam o worker.
 */

import type { Pool } from "pg";
import { withTransaction } from "../../core/db/pool.js";
import { listDueCampaigns, processCampaignBatch } from "./campaign-service.js";

/** Controle de um worker de campanhas em execução. */
export interface CampaignWorker {
  /** Interrompe o worker. */
  stop: () => void;
}

/**
 * Inicia o worker de campanhas, processando um lote por campanha devida a cada
 * `intervalMs`.
 *
 * @param pool - Pool de conexões.
 * @param options - `intervalMs` (default 15000) e `onError` opcional.
 * @returns Um {@link CampaignWorker} com `stop()`.
 */
export function startCampaignWorker(
  pool: Pool,
  options: { intervalMs?: number; onError?: (err: unknown) => void } = {},
): CampaignWorker {
  const intervalMs = options.intervalMs ?? 15000;
  let running = false;
  let stopped = false;

  const tick = async (): Promise<void> => {
    if (running || stopped) return;
    running = true;
    try {
      const due = await withTransaction(pool, (c) => listDueCampaigns(c));
      for (const campaignId of due) {
        // Cada lote em sua própria transação para isolar falhas por campanha.
        await withTransaction(pool, (c) => processCampaignBatch(c, campaignId)).catch((e) => options.onError?.(e));
      }
    } catch (err) {
      options.onError?.(err);
    } finally {
      running = false;
    }
  };

  const handle = setInterval(() => void tick(), intervalMs);
  handle.unref?.();

  return {
    stop: () => {
      stopped = true;
      clearInterval(handle);
    },
  };
}
