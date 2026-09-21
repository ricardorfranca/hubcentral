/**
 * @file import-export.ts
 * @module core/api
 *
 * Cliente do Assistente de Importação/Exportação de Contatos (superadmin).
 * O preview envia o arquivo via multipart; a importação envia as linhas
 * parseadas como JSON; a exportação baixa o binário/texto via fetch direto.
 */

import { request } from "./client.js";
import { getToken } from "../auth/session-store.js";
import type { CustomFieldDataType, CustomFieldDef, ContactLabel } from "./contacts.js";

/** Formatos de arquivo suportados. */
export type IoFormat = "csv" | "json" | "xlsx";

/** Uma linha genérica do arquivo (célula = texto). */
export type IoRecord = Record<string, string>;

/** Campos padrão de contato que uma coluna pode alimentar. */
export type StandardField = "full_name" | "email" | "phone" | "legal_name" | "fiscal_document";

/** Mapeamento de uma coluna do arquivo para um destino. */
export type ColumnMapping =
  | { column: string; target: "ignore" }
  | { column: string; target: "standard"; field: StandardField }
  | { column: string; target: "custom_existing"; fieldId: string }
  | { column: string; target: "custom_new"; name: string; dataType: CustomFieldDataType };

/** Resposta do preview de importação. */
export interface ImportPreview {
  format: IoFormat;
  total_rows: number;
  headers: string[];
  sample: IoRecord[];
  rows: IoRecord[];
  custom_fields: CustomFieldDef[];
  labels: ContactLabel[];
  standard_fields: StandardField[];
}

/** Uma linha rejeitada no relatório de importação. */
export interface RejectedImportRow {
  line: number;
  reason: string;
  row: IoRecord;
}

/** Relatório consolidado da importação. */
export interface ContactsImportResult {
  created: number;
  updated: number;
  skipped: number;
  rejected: RejectedImportRow[];
  createdFields: { id: string; name: string; data_type: CustomFieldDataType }[];
}

/** Estratégia para contatos já existentes. */
export type DuplicateStrategy = "skip" | "update";

/**
 * Envia o arquivo e obtém o preview (cabeçalhos, amostra, campos e rótulos).
 *
 * @param file - Arquivo .csv, .xlsx ou .json.
 * @returns O preview com as linhas parseadas.
 */
export async function previewImport(file: File): Promise<ImportPreview> {
  const token = getToken();
  const form = new FormData();
  form.append("file", file);
  const res = await fetch("/api/import-export/contacts/preview", {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: "Falha ao ler o arquivo." }));
    throw new Error(body.message ?? "Falha ao ler o arquivo.");
  }
  return res.json() as Promise<ImportPreview>;
}

/** Executa a importação com o mapeamento montado no assistente. */
export function runImport(params: {
  contact_type: "pessoa" | "empresa";
  rows: IoRecord[];
  mappings: ColumnMapping[];
  label_ids: string[];
  duplicate_strategy: DuplicateStrategy;
}): Promise<ContactsImportResult> {
  return request<ContactsImportResult>("/api/import-export/contacts/import", {
    method: "POST",
    body: params,
  });
}

/** Coluna padrão exportável. */
export type StandardExportColumn =
  | "id"
  | "contact_type"
  | "full_name"
  | "email"
  | "phone"
  | "legal_name"
  | "fiscal_document"
  | "labels"
  | "created_at"
  | "updated_at";

/** Metadados para montar a tela de exportação. */
export interface ExportMetadata {
  standard_columns: StandardExportColumn[];
  custom_fields: CustomFieldDef[];
  labels: ContactLabel[];
  formats: IoFormat[];
}

/** Obtém colunas padrão, campos personalizados e rótulos para a exportação. */
export function getExportMetadata(): Promise<ExportMetadata> {
  return request<ExportMetadata>("/api/import-export/contacts/export-metadata");
}

/** Dispara o download da exportação de contatos no formato escolhido. */
export async function downloadExport(params: {
  format: IoFormat;
  filters?: { type?: "pessoa" | "empresa"; label_id?: string; search?: string };
  standard_columns?: StandardExportColumn[];
  custom_field_ids?: string[];
}): Promise<void> {
  const token = getToken();
  const res = await fetch("/api/import-export/contacts/export", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: "Falha ao exportar." }));
    throw new Error(body.message ?? "Falha ao exportar.");
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `hubcentral-contatos-${new Date().toISOString().slice(0, 10)}.${params.format}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Gera e baixa um relatório CSV das linhas rejeitadas na importação. */
export function downloadRejectedReport(rejected: RejectedImportRow[]): void {
  const escape = (s: string): string => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const header = ["linha", "motivo"];
  const lines = [header.join(",")];
  for (const r of rejected) {
    lines.push([String(r.line), escape(r.reason)].join(","));
  }
  const blob = new Blob([lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `importacao-rejeitadas-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
