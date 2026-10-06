/// <reference types="vitest/config" />
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Versão do produto, lida do package.json raiz do monorepo para exibição na UI.
const rootPkg = JSON.parse(
  readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"),
) as { version?: string };
const APP_VERSION = rootPkg.version ?? "0.0.0";

/**
 * Configuração do Vite para o frontend do HUB Central.
 *
 * - Plugin React (JSX/Fast Refresh).
 * - Proxy de desenvolvimento: encaminha `/api` para o backend local (porta 3000),
 *   espelhando o comportamento do nginx em produção.
 * - Vitest com ambiente jsdom e setup do Testing Library.
 */
export default defineConfig({
  plugins: [react()],
  define: {
    // Disponibiliza a versão instalada para o código do frontend.
    __APP_VERSION__: JSON.stringify(APP_VERSION),
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3000",
        changeOrigin: true,
      },
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    css: false,
  },
});
