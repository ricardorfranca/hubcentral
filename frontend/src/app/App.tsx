/**
 * @file App.tsx
 * @module app
 *
 * Composição da aplicação: rotas públicas (login/definir-senha) e rotas
 * protegidas dentro do Shell, montadas a partir do Registro_Modulos. Os
 * módulos declaram suas rotas; o App apenas as agrega (Req 2.1, 2.2).
 */

import { useEffect } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { LoginPage } from "../core/auth/LoginPage.js";
import { SetPasswordPage } from "../core/auth/SetPasswordPage.js";
import { AuthGuard } from "./AuthGuard.js";
import { Shell } from "./Shell.js";
import { MODULE_REGISTRY } from "../core/modules/registry.js";
import { getBranding } from "../core/api/branding.js";
import { useBrandingStore } from "../core/branding/branding-store.js";

/**
 * Raiz de roteamento da aplicação.
 *
 * @returns As rotas da aplicação.
 */
export function App(): JSX.Element {
  const setBranding = useBrandingStore((s) => s.setBranding);

  // Carrega a identidade visual do sistema no boot (nome, logo, cores).
  useEffect(() => {
    getBranding()
      .then((b) =>
        setBranding({
          systemName: b.system_name,
          logoUrl: b.logo_url,
          primaryColor: b.primary_color,
          secondaryColor: b.secondary_color,
        }),
      )
      .catch(() => {
        // Mantém o branding padrão se a API não responder.
      });
  }, [setBranding]);

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/definir-senha" element={<SetPasswordPage />} />

      <Route
        path="/*"
        element={
          <AuthGuard>
            <Shell>
              <Routes>
                <Route path="/" element={<Navigate to={firstModulePath()} replace />} />
                {MODULE_REGISTRY.flatMap((m) =>
                  m.routes.map((route) => (
                    <Route key={`${m.id}:${route.path}`} path={route.path} element={route.element} />
                  )),
                )}
              </Routes>
            </Shell>
          </AuthGuard>
        }
      />
    </Routes>
  );
}

/** Caminho inicial: o basePath do primeiro módulo registrado (ou raiz). */
function firstModulePath(): string {
  return MODULE_REGISTRY[0]?.basePath ?? "/";
}
