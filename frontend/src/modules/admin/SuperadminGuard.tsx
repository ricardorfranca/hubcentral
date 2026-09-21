/**
 * @file SuperadminGuard.tsx
 * @module modules/admin
 *
 * Guarda de rota que exige o papel `superadmin`. Os assistentes de importação
 * e exportação de dados manipulam a base em massa e são exclusivos do
 * SuperAdministrador (o backend também impõe essa restrição). Para usuários sem
 * o papel, renderiza a página de acesso negado.
 */

import type { ReactNode } from "react";
import { useSessionStore } from "../../core/auth/session-store.js";
import { AccessDenied } from "../../app/AccessDenied.js";

/** Indica, de forma reativa, se a sessão atual é de um SuperAdministrador. */
export function useIsSuperadmin(): boolean {
  return useSessionStore((s) => s.user?.role === "superadmin");
}

/**
 * Envolve um conteúdo, exibindo-o apenas para SuperAdministradores.
 *
 * @param props.children - Conteúdo protegido.
 * @returns O conteúdo, ou a página de acesso negado.
 */
export function SuperadminGuard({ children }: { children: ReactNode }): JSX.Element {
  const isSuperadmin = useIsSuperadmin();
  return isSuperadmin ? <>{children}</> : <AccessDenied />;
}
