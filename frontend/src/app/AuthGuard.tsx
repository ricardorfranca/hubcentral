/**
 * @file AuthGuard.tsx
 * @module app
 *
 * Protege rotas: sem sessão válida, redireciona para o login (Req 1.4).
 */

import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useSessionStore } from "../core/auth/session-store.js";

/**
 * Renderiza `children` apenas se houver sessão; caso contrário redireciona.
 *
 * @param props.children - Conteúdo protegido.
 * @returns O conteúdo ou um redirecionamento ao login.
 */
export function AuthGuard({ children }: { children: ReactNode }): JSX.Element {
  const token = useSessionStore((s) => s.token);
  if (!token) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}
