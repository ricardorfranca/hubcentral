/**
 * @file contacts-export.ts
 * @module core/io
 *
 * Serviço do Assistente de Exportação de Contatos. Monta uma matriz de
 * registros (`IoRecord`) achatando, para cada contato, os campos padrão,
 * os valores de campos personalizados selecionados e os rótulos aplicados,
 * respeitando filtros (tipo, rótulo) e a seleção de colunas do assistente.
 */

import type { PoolClient } from "pg";
import type { IoRecord } from "./formats.js";

/** Campos padrão exportáveis de um contato. */
export const STANDARD_EXPORT_COLUMNS = [
  "id",
  "contact_type",
  "full_name",
  "email",
  "phone",
  "legal_name",
  "fiscal_document",
  "labels",
  "created_at",
  "updated_at",
] as const;

/** Nome de coluna padrão exportável. */
export type StandardExportColumn = (typeof STANDARD_EXPORT_COLUMNS)[number];

/** Filtros da exportação. */
export interface ContactsExportFilters {
  /** Restringe ao tipo (pessoa|empresa). */
  type?: "pessoa" | "empresa";
  /** Restringe aos contatos que possuem este rótulo (category_id). */
  labelId?: string;
  /** Busca textual (nome/e-mail/razão social/documento/telefone). */
  search?: string;
}

/** Opções da exportação de contatos. */
export interface ContactsExportOptions {
  filters?: ContactsExportFilters;
  /** Campos padrão a incluir (na ordem desejada). Se omitido, inclui todos. */
  standardColumns?: readonly StandardExportColumn[];
  /** Ids de campos personalizados a incluir como colunas. */
  customFieldIds?: readonly string[];
}

/** Resultado da montagem da exportação: registros e a ordem das colunas. */
export interface ContactsExportData {
  rows: IoRecord[];
  columns: string[];
}

/** Linha crua de contato retornada pela consulta de exportação. */
interface ExportContactRow {
  id: string;
  contact_type: "pessoa" | "empresa";
  full_name: string | null;
  email: string | null;
  phone: string | null;
  legal_name: string | null;
  fiscal_document: string | null;
  created_at: Date;
  updated_at: Date;
  labels: { id: string; name: string }[];
}

/** Serializa um valor JSONB de campo personalizado para texto de célula. */
function customValueToCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "sim" : "não";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/**
 * Monta os dados de exportação de contatos conforme filtros e colunas.
 *
 * @param client - Cliente PostgreSQL.
 * @param opts - Filtros e seleção de colunas.
 * @returns Registros achatados e a ordem final das colunas.
 */
export async function buildContactsExport(
  client: PoolClient,
  opts: ContactsExportOptions = {},
): Promise<ContactsExportData> {
  const standardCols = (opts.standardColumns && opts.standardColumns.length > 0
    ? opts.standardColumns
    : STANDARD_EXPORT_COLUMNS) as readonly StandardExportColumn[];
  const customFieldIds = opts.customFieldIds ?? [];

  // Consulta contatos ativos, com rótulos, aplicando filtros.
  const params: unknown[] = [];
  const where: string[] = ["c.merged_into IS NULL"];
  if (opts.filters?.type) {
    params.push(opts.filters.type);
    where.push(`c.contact_type = $${params.length}`);
  }
  if (opts.filters?.search && opts.filters.search.trim()) {
    params.push(`%${opts.filters.search.trim()}%`);
    const p = `$${params.length}`;
    where.push(
      `(c.full_name ILIKE ${p} OR c.email::text ILIKE ${p} OR c.legal_name ILIKE ${p} OR c.fiscal_document::text ILIKE ${p} OR c.phone ILIKE ${p})`,
    );
  }
  if (opts.filters?.labelId) {
    params.push(opts.filters.labelId);
    where.push(
      `EXISTS (SELECT 1 FROM core.contact_category_assignments a WHERE a.contact_id = c.id AND a.category_id = $${params.length})`,
    );
  }

  const { rows: contacts } = await client.query<ExportContactRow>(
    `SELECT c.id, c.contact_type, c.full_name, c.email, c.phone, c.legal_name,
            c.fiscal_document, c.created_at, c.updated_at,
            COALESCE(
              (SELECT json_agg(json_build_object('id', cat.id, 'name', cat.name) ORDER BY cat.name)
               FROM core.contact_category_assignments ca
               JOIN core.contact_categories cat ON cat.id = ca.category_id
               WHERE ca.contact_id = c.id),
              '[]'::json
            ) AS labels
     FROM core.contacts c
     WHERE ${where.join(" AND ")}
     ORDER BY COALESCE(c.full_name, c.legal_name)`,
    params,
  );

  // Carrega os campos personalizados selecionados (nome + valores por contato).
  const customDefs: { id: string; name: string }[] = [];
  const customValues = new Map<string, Map<string, unknown>>(); // contactId -> (fieldId -> value)
  if (customFieldIds.length > 0) {
    const { rows: defs } = await client.query<{ id: string; name: string }>(
      `SELECT id, name FROM core.custom_field_defs WHERE id = ANY($1::uuid[]) ORDER BY name`,
      [customFieldIds],
    );
    customDefs.push(...defs);

    const { rows: values } = await client.query<{ contact_id: string; field_id: string; value: unknown }>(
      `SELECT contact_id, field_id, value
       FROM core.contact_custom_field_values
       WHERE field_id = ANY($1::uuid[])`,
      [customFieldIds],
    );
    for (const v of values) {
      let byField = customValues.get(v.contact_id);
      if (!byField) {
        byField = new Map();
        customValues.set(v.contact_id, byField);
      }
      byField.set(v.field_id, v.value);
    }
  }

  // Ordem final das colunas: padrão selecionadas + nomes dos campos personalizados.
  const columns: string[] = [...standardCols, ...customDefs.map((d) => d.name)];

  const rows: IoRecord[] = contacts.map((c) => {
    const record: IoRecord = {};
    for (const col of standardCols) {
      switch (col) {
        case "labels":
          record[col] = c.labels.map((l) => l.name).join("; ");
          break;
        case "created_at":
          record[col] = c.created_at instanceof Date ? c.created_at.toISOString() : String(c.created_at);
          break;
        case "updated_at":
          record[col] = c.updated_at instanceof Date ? c.updated_at.toISOString() : String(c.updated_at);
          break;
        default: {
          const value = c[col];
          record[col] = value === null || value === undefined ? "" : String(value);
        }
      }
    }
    const byField = customValues.get(c.id);
    for (const def of customDefs) {
      record[def.name] = customValueToCell(byField?.get(def.id));
    }
    return record;
  });

  return { rows, columns };
}
