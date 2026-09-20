/**
 * @file session-store.ts
 * @module core/auth
 *
 * Estado global da sessão de autenticação (Zustand), persistido em
 * localStorage para sobreviver a recarregamentos. Guarda o token e o usuário
 * logado, com permissões RBAC para o guard e o controle de acesso na UI.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { AuthUser } from "../api/types.js";

/** Estado e ações da sessão. */
interface SessionState {
  token: string | null;
  user: AuthUser | null;
  /** Namespaces RBAC concedidos ao usuário. */
  permissions: string[];
  /** Registra a sessão após login bem-sucedido. */
  setSession: (token: string, user: AuthUser, permissions: string[]) => void;
  /** Limpa a sessão (logout local / 401). */
  clear: () => void;
  /** Indica se há sessão ativa. */
  isAuthenticated: () => boolean;
}

/** Store da sessão, persistido sob a chave `hubcentral.session`. */
export const useSessionStore = create<SessionState>()(
  persist(
    (set, get) => ({
      token: null,
      user: null,
      permissions: [],
      setSession: (token, user, permissions) => set({ token, user, permissions }),
      clear: () => set({ token: null, user: null, permissions: [] }),
      isAuthenticated: () => get().token !== null,
    }),
    { name: "hubcentral.session" },
  ),
);

/**
 * Lê o token atual fora de componentes React (para o ApiClient).
 *
 * @returns O token da sessão, ou `null`.
 */
export function getToken(): string | null {
  return useSessionStore.getState().token;
}

/**
 * Limpa a sessão fora de componentes React (para o ApiClient em caso de 401).
 */
export function clearSession(): void {
  useSessionStore.getState().clear();
}
