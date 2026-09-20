/**
 * @file auth.ts
 * @module core/api
 *
 * Funções tipadas dos endpoints de autenticação (IAM).
 */

import { request } from "./client.js";
import type { LoginResponse } from "./types.js";

/**
 * Autentica por e-mail e senha.
 *
 * @param email - E-mail do usuário.
 * @param password - Senha.
 * @returns Token, usuário e flag de troca de senha.
 */
export function login(email: string, password: string): Promise<LoginResponse> {
  return request<LoginResponse>("/api/auth/login", {
    method: "POST",
    body: { email, password },
    authenticated: false,
  });
}

/**
 * Define uma nova senha (primeiro acesso ou troca). Requer sessão.
 *
 * @param newPassword - Nova senha.
 */
export function setPassword(newPassword: string): Promise<void> {
  return request<void>("/api/auth/set-password", {
    method: "POST",
    body: { new_password: newPassword },
  });
}

/**
 * Encerra a sessão atual no servidor.
 */
export function logout(): Promise<void> {
  return request<void>("/api/auth/logout", { method: "POST" });
}
