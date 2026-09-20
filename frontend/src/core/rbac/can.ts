/**
 * @file can.ts
 * @module core/rbac
 *
 * Verificação de permissões RBAC no cliente, a partir dos namespaces da sessão.
 * Espelha o modelo do backend (`[modulo]:[recurso]:[acao]`).
 */

import { useSessionStore } from "../auth/session-store.js";

/**
 * Indica se o conjunto de permissões concede um namespace. Sem namespace
 * exigido (`undefined`), sempre concede.
 *
 * @param permissions - Namespaces do usuário.
 * @param namespace - Namespace exigido (opcional).
 * @returns `true` se permitido.
 */
export function hasPermission(permissions: readonly string[], namespace?: string): boolean {
  if (!namespace) return true;
  return permissions.includes(namespace);
}

/**
 * Hook que retorna uma função `can(namespace)` ligada às permissões da sessão.
 *
 * @returns Função `can` reativa às permissões atuais.
 */
export function useCan(): (namespace?: string) => boolean {
  const permissions = useSessionStore((s) => s.permissions);
  return (namespace?: string) => hasPermission(permissions, namespace);
}
