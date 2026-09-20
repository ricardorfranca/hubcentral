/**
 * @file custom-field-service.ts
 * @module core/contacts
 *
 * Serviço de campos personalizados (Req 4). Modelo híbrido: definições
 * relacionais tipadas + valores JSONB validados contra o tipo da definição.
 */

import type { PoolClient } from "pg";
import { DomainError, ErrorCode } from "../errors.js";

/** Tipos de dado suportados por um campo personalizado (Req 4.1). */
export type CustomFieldDataType = "text" | "number" | "boolean" | "date";

/** Todos os tipos de dado válidos, para iteração/validação. */
export const CUSTOM_FIELD_DATA_TYPES: readonly CustomFieldDataType[] = [
  "text",
  "number",
  "boolean",
  "date",
];

/** Definição de campo personalizado como persistida. */
export interface CustomFieldDef {
  id: string;
  name: string;
  data_type: CustomFieldDataType;
  created_at: Date;
}

/** Tamanho máximo do nome de um campo personalizado. */
const FIELD_NAME_MAX_LENGTH = 100;

/** Regex de data no formato ISO `YYYY-MM-DD`. */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Verifica se um valor JS é compatível com o `data_type` de um campo (Req 4.3).
 *
 * Regras por tipo:
 *  - `text`: string
 *  - `number`: número finito (não NaN/Infinity)
 *  - `boolean`: booleano
 *  - `date`: string ISO `YYYY-MM-DD` que representa uma data de calendário válida
 *
 * @param dataType - Tipo esperado do campo.
 * @param value - Valor candidato.
 * @returns `true` se o valor está em conformidade com o tipo.
 */
export function isValueOfType(dataType: CustomFieldDataType, value: unknown): boolean {
  switch (dataType) {
    case "text":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
    case "date": {
      if (typeof value !== "string" || !ISO_DATE_RE.test(value)) {
        return false;
      }
      // Rejeita datas de calendário inválidas (ex.: 2026-02-31).
      const parsed = new Date(`${value}T00:00:00Z`);
      return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
    }
    default:
      return false;
  }
}

/**
 * Define um campo personalizado tipado (Req 4.1). Nome único case-insensitive.
 *
 * @param client - Cliente PostgreSQL.
 * @param name - Nome do campo (ex.: "escola_dos_filhos").
 * @param dataType - Tipo de dado do campo.
 * @returns A definição criada.
 * @throws {DomainError} `CUSTOM_FIELD_INVALID_NAME` se o nome for vazio/em branco ou exceder o limite.
 * @throws {DomainError} `CUSTOM_FIELD_DUPLICATE_NAME` se já existir campo com o mesmo nome.
 */
export async function defineCustomField(
  client: PoolClient,
  name: string,
  dataType: CustomFieldDataType,
): Promise<CustomFieldDef> {
  const trimmed = name.trim();
  if (trimmed === "" || trimmed.length > FIELD_NAME_MAX_LENGTH) {
    throw new DomainError(
      ErrorCode.CUSTOM_FIELD_INVALID_NAME,
      `O nome do campo deve ter de 1 a ${FIELD_NAME_MAX_LENGTH} caracteres.`,
      { max_length: FIELD_NAME_MAX_LENGTH },
    );
  }

  const existing = await client.query<{ id: string }>(
    `SELECT id FROM core.custom_field_defs WHERE name = $1 LIMIT 1`,
    [trimmed],
  );
  if (existing.rows[0]) {
    throw new DomainError(
      ErrorCode.CUSTOM_FIELD_DUPLICATE_NAME,
      "Já existe um campo personalizado com este nome.",
      { existing_field_id: existing.rows[0].id },
    );
  }

  const { rows } = await client.query<CustomFieldDef>(
    `INSERT INTO core.custom_field_defs (name, data_type)
     VALUES ($1, $2)
     RETURNING id, name, data_type, created_at`,
    [trimmed, dataType],
  );
  return rows[0] as CustomFieldDef;
}

/**
 * Atribui/atualiza o valor de um campo personalizado para um contato (Req 4.2),
 * validando o valor contra o `data_type` da definição (Req 4.3, 4.4).
 *
 * @param client - Cliente PostgreSQL.
 * @param contactId - `contact_id` do contato.
 * @param fieldId - `id` da definição do campo.
 * @param value - Valor a atribuir (deve conformar ao tipo do campo).
 * @throws {DomainError} `CUSTOM_FIELD_NOT_FOUND` se o campo não existe.
 * @throws {DomainError} `CUSTOM_FIELD_TYPE_MISMATCH` se o valor não conforma ao tipo (Req 4.4).
 */
export async function setCustomFieldValue(
  client: PoolClient,
  contactId: string,
  fieldId: string,
  value: unknown,
): Promise<void> {
  const def = await client.query<{ data_type: CustomFieldDataType }>(
    `SELECT data_type FROM core.custom_field_defs WHERE id = $1`,
    [fieldId],
  );
  const dataType = def.rows[0]?.data_type;
  if (!dataType) {
    throw new DomainError(
      ErrorCode.CUSTOM_FIELD_NOT_FOUND,
      "Campo personalizado não encontrado.",
      { field_id: fieldId },
    );
  }

  if (!isValueOfType(dataType, value)) {
    throw new DomainError(
      ErrorCode.CUSTOM_FIELD_TYPE_MISMATCH,
      `O valor não corresponde ao tipo '${dataType}' do campo.`,
      { expected_type: dataType },
    );
  }

  await client.query(
    `INSERT INTO core.contact_custom_field_values (contact_id, field_id, value)
     VALUES ($1, $2, $3::jsonb)
     ON CONFLICT (contact_id, field_id)
     DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [contactId, fieldId, JSON.stringify(value)],
  );
}

/**
 * Retorna os `contact_id` cujos valores do campo indicado são iguais ao valor
 * informado (Req 4.5).
 *
 * @param client - Cliente PostgreSQL.
 * @param fieldId - `id` da definição do campo.
 * @param value - Valor a procurar (comparação por igualdade JSONB).
 * @returns Lista de `contact_id` que possuem o valor.
 */
export async function findContactsByCustomField(
  client: PoolClient,
  fieldId: string,
  value: unknown,
): Promise<string[]> {
  const { rows } = await client.query<{ contact_id: string }>(
    `SELECT contact_id FROM core.contact_custom_field_values
     WHERE field_id = $1 AND value = $2::jsonb`,
    [fieldId, JSON.stringify(value)],
  );
  return rows.map((r) => r.contact_id);
}
