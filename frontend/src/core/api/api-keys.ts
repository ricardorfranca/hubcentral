/**
 * @file api-keys.ts
 * @module core/api
 *
 * Cliente das chaves de API externas (administração). Gestão exclusiva do
 * SuperAdministrador. O segredo em claro só é retornado na criação.
 */

import { request } from "./client.js";

/** Chave de API (sem o segredo), como listada na administração. */
export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  status: "active" | "revoked";
  created_by: string | null;
  last_used_at: string | null;
  created_at: string;
  revoked_at: string | null;
  permissions: string[];
}

/** Resultado da criação de uma chave: inclui o segredo em claro (mostrar 1x). */
export interface CreatedApiKey extends Omit<ApiKey, "permissions"> {
  secret: string;
}

/** Lista as chaves de API cadastradas (com permissões). */
export function listApiKeys(): Promise<ApiKey[]> {
  return request<ApiKey[]>("/api/iam/api-keys");
}

/** Lista os namespaces concedíveis a chaves de API. */
export function listApiKeyNamespaces(): Promise<string[]> {
  return request<{ namespaces: string[] }>("/api/iam/api-keys/namespaces").then((r) => r.namespaces);
}

/** Cria uma chave de API. Retorna o segredo em claro (exibir uma única vez). */
export function createApiKey(name: string): Promise<CreatedApiKey> {
  return request<CreatedApiKey>("/api/iam/api-keys", { method: "POST", body: { name } });
}

/** Define as permissões (namespaces) de uma chave. */
export function setApiKeyPermissions(id: string, permissions: string[]): Promise<void> {
  return request<void>(`/api/iam/api-keys/${id}/permissions`, { method: "PUT", body: { permissions } });
}

/** Revoga uma chave de API. */
export function revokeApiKey(id: string): Promise<void> {
  return request<void>(`/api/iam/api-keys/${id}/revoke`, { method: "POST" });
}
