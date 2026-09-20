/**
 * @file server.ts
 * @module .
 *
 * Ponto de entrada do processo HUB Central: cria o pool, sobe a API HTTP e
 * inicia o worker de despacho do outbox. Encerra ambos de forma limpa em
 * SIGINT/SIGTERM.
 */

import { createPool } from "./core/db/pool.js";
import { buildApp } from "./http/app.js";
import { startOutboxWorker } from "./core/events/outbox-worker.js";
import { startCampaignWorker } from "./modules/crm/campaign-worker.js";
import { registerProjetosNotifier } from "./modules/projetos/notifier.js";

/**
 * Inicializa e executa o servidor HUB Central.
 *
 * @returns Promessa que resolve quando o servidor está escutando.
 */
async function main(): Promise<void> {
  const pool = createPool();
  const app = buildApp(pool);
  // Assinantes de eventos (outbox -> notificações in-app).
  registerProjetosNotifier(pool);
  const worker = startOutboxWorker(pool, { intervalMs: 1000 });
  // Worker de disparo automático de campanhas (agendamento + throttling).
  const campaignWorker = startCampaignWorker(pool, { intervalMs: 15000 });

  const port = Number(process.env.PORT ?? 3000);
  await app.listen({ port, host: "0.0.0.0" });

  const shutdown = async (): Promise<void> => {
    worker.stop();
    campaignWorker.stop();
    await app.close();
    await pool.end();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

main().catch((err) => {
  console.error("Falha ao iniciar o HUB Central:", err);
  process.exit(1);
});
