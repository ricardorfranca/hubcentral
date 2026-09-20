import { defineConfig } from "vitest/config";

/**
 * Configuração do Vitest para o HUB Central.
 *
 * - Ambiente Node (não jsdom): testamos backend e banco.
 * - Sem paralelismo entre arquivos de teste que compartilham o container
 *   Postgres: usamos um único container global levantado no setup.
 * - Timeout elevado para acomodar a subida do container Postgres 15.
 */
export default defineConfig({
  test: {
    environment: "node",
    globalSetup: ["./tests/global-setup.ts"],
    testTimeout: 30_000,
    hookTimeout: 120_000,
    include: ["tests/**/*.test.ts"],
    // O container Postgres é compartilhado; rodar arquivos em série evita
    // contenção. O isolamento entre casos é feito por transação revertida.
    fileParallelism: false,
  },
});
