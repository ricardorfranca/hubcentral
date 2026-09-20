/**
 * @file branding.ts
 * @module core/api
 *
 * Cliente da identidade visual (branding) do sistema. O endpoint é público
 * (sem autenticação) para que a tela de login e o boot apliquem nome, logo e
 * cores.
 */

import { request } from "./client.js";

/** Branding retornado pela API. */
export interface BrandingResponse {
  system_name: string;
  logo_url: string | null;
  primary_color: string;
  secondary_color: string;
}

/** Lê o branding público do sistema. */
export function getBranding(): Promise<BrandingResponse> {
  return request<BrandingResponse>("/api/branding", { authenticated: false });
}

/** Envia um logotipo (multipart) e define a URL no branding. Requer admin. */
export async function uploadLogo(file: File): Promise<{ logo_url: string }> {
  const { getToken } = await import("../auth/session-store.js");
  const form = new FormData();
  form.append("file", file);
  const token = getToken();
  const res = await fetch("/api/settings/branding/logo", {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: "Falha no upload do logotipo." }));
    throw new Error(body.message ?? "Falha no upload do logotipo.");
  }
  return res.json() as Promise<{ logo_url: string }>;
}
