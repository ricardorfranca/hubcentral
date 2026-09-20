/**
 * @file settings.ts
 * @module core/api
 *
 * Cliente tipado da Central de Configurações do HUB Central (admin).
 */

import { request } from "./client.js";

/** Tipo de valor de uma configuração. */
export type SettingType = "int" | "bool" | "string" | "json" | "csv";

/** Configuração como retornada pela API. */
export interface Setting {
  key: string;
  module: string;
  value: string | null;
  value_type: SettingType;
  label: string;
  description: string | null;
  default_value: string | null;
  updated_at: string;
}

/** Lista as configurações (opcionalmente por módulo). */
export function listSettings(module?: string): Promise<Setting[]> {
  return request<Setting[]>(`/api/settings${module ? `?module=${encodeURIComponent(module)}` : ""}`);
}

/** Atualiza o valor de um parâmetro (null volta ao default). */
export function updateSetting(key: string, value: string | null): Promise<Setting> {
  return request<Setting>(`/api/settings/${encodeURIComponent(key)}`, { method: "PATCH", body: { value } });
}
