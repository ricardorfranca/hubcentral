/**
 * @file can.ts
 * @module core/rbac
 *
 * Verificação de permissões RBAC no cliente, a partir dos namespaces da sessão.
 * Espelha o modelo do backend (`[modulo]:[recurso]:[acao]`).
 */

import { useSessionStore } from "../auth/session-store.js";
import type { AuthUser } from "../api/types.js";

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

/**
 * Indica se o usuário tem o papel `superadmin` — paridade com o helper
 * `isSuperadmin` do backend (`core/iam/rbac`).
 *
 * SuperAdministradores têm acesso total aos projetos no backend (listagem,
 * detalhe, tarefas e escrita), mesmo sem serem membros. A UI de projetos não
 * aplica gate de membership no cliente: ela renderiza o que o backend retorna e
 * só usa `can("projetos:...")` (namespace), que o superadmin já possui. Logo,
 * com o backend corrigido, o admin já vê e age em todos os projetos sem mudança
 * de visibilidade no cliente. Este helper fica disponível para checagens de
 * papel futuras e para paridade com o backend.
 *
 * @param user - Usuário autenticado da sessão (ou `undefined`/`null`).
 * @returns `true` se o papel for `superadmin`.
 */
export function isSuperadmin(user: AuthUser | null | undefined): boolean {
  return user?.role === "superadmin";
}

/**
 * Hook que retorna se o usuário da sessão é `superadmin`.
 *
 * @returns `true` se o usuário autenticado tem papel `superadmin`.
 */
export function useIsSuperadmin(): boolean {
  const user = useSessionStore((s) => s.user);
  return isSuperadmin(user);
}
