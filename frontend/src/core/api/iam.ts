/**
 * @file iam.ts
 * @module core/api
 *
 * Funções tipadas dos endpoints de administração de usuários (IAM).
 */

import { request } from "./client.js";
import type { UserRole } from "./types.js";

/** Usuário na administração. */
export interface AdminUser {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  status: "active" | "disabled";
  password_set: boolean;
  /** Ramal do usuário no PABX (discagem via curl). */
  extension: string | null;
}

/** Lista o catálogo de namespaces RBAC disponíveis. */
export function listNamespaces(): Promise<string[]> {
  return request<{ namespaces: string[] }>("/api/iam/namespaces").then((r) => r.namespaces);
}

/** Lista os usuários. */
export function listUsers(): Promise<AdminUser[]> {
  return request<AdminUser[]>("/api/iam/users");
}

/** Usuário reduzido, para preencher seletores de responsável. */
export interface UserOption {
  id: string;
  full_name: string;
  email: string;
}

/**
 * Lista os usuários ativos reduzidos a id/nome/e-mail. Não exige a permissão de
 * administração de usuários — serve para seletores como o gerente de contas de
 * uma empresa.
 */
export function listUserOptions(): Promise<UserOption[]> {
  return request<UserOption[]>("/api/users/options");
}

/** Convida um novo usuário. */
export function inviteUser(email: string, fullName: string, role: UserRole): Promise<AdminUser> {
  return request<AdminUser>("/api/iam/users", { method: "POST", body: { email, full_name: fullName, role } });
}

/** Reenvia o convite de um usuário. */
export function resendInvite(id: string): Promise<void> {
  return request<void>(`/api/iam/users/${id}/resend`, { method: "POST" });
}

/** Altera papel, status e/ou ramal de um usuário. */
export function updateUser(
  id: string,
  patch: { role?: UserRole; status?: "active" | "disabled"; extension?: string | null },
): Promise<AdminUser> {
  return request<AdminUser>(`/api/iam/users/${id}`, { method: "PATCH", body: patch });
}

/** Lê as permissões de um usuário. */
export function getUserPermissions(id: string): Promise<string[]> {
  return request<{ permissions: string[] }>(`/api/iam/users/${id}/permissions`).then((r) => r.permissions);
}

/** Substitui o conjunto de permissões de um usuário. */
export function setUserPermissions(id: string, permissions: string[]): Promise<void> {
  return request<void>(`/api/iam/users/${id}/permissions`, { method: "PUT", body: { permissions } });
}

/** Define/atribui a senha de um usuário (admin). */
export function setUserPassword(id: string, password: string): Promise<void> {
  return request<void>(`/api/iam/users/${id}/password`, { method: "POST", body: { password } });
}
