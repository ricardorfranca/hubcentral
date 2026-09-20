/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

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
