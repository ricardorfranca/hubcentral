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

/**
 * Entidades que suportam campos personalizados. Cada módulo declara aqui as
 * entidades cujos registros podem ser enriquecidos com campos personalizados.
 * O SuperAdministrador escolhe a entidade (módulo a módulo) ao definir campos.
 */
export const CUSTOM_FIELD_ENTITIES = [
  "contact",
  "crm_opportunity",
  "projetos_task",
] as const;

/** Entidade dona de um campo personalizado. */
export type CustomFieldEntity = (typeof CUSTOM_FIELD_ENTITIES)[number];

/** Entidade padrão (compatibilidade com o comportamento original: contatos). */
export const DEFAULT_CUSTOM_FIELD_ENTITY: CustomFieldEntity = "contact";

/** Indica se um valor é uma entidade de campo personalizado conhecida. */
export function isCustomFieldEntity(value: unknown): value is CustomFieldEntity {
  return typeof value === "string" && (CUSTOM_FIELD_ENTITIES as readonly string[]).includes(value);
}

/** Definição de campo personalizado como persistida. */
export interface CustomFieldDef {
  id: string;
  name: string;
  data_type: CustomFieldDataType;
  entity: CustomFieldEntity;
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
 * Lista definições de campos personalizados de uma entidade, ordenadas por
 * nome. Por padrão, lista os campos de contato (compatibilidade).
 *
 * @param client - Cliente PostgreSQL.
 * @param entity - Entidade dona dos campos (default: `contact`).
 * @returns As definições cadastradas da entidade.
 */
export async function listCustomFieldDefs(
  client: PoolClient,
  entity: CustomFieldEntity = DEFAULT_CUSTOM_FIELD_ENTITY,
): Promise<CustomFieldDef[]> {
  const { rows } = await client.query<CustomFieldDef>(
    `SELECT id, name, data_type, entity, created_at
     FROM core.custom_field_defs WHERE entity = $1 ORDER BY name`,
    [entity],
  );
  return rows;
}

/**
 * Remove uma definição de campo personalizado (e, em cascata, seus valores).
 *
 * @param client - Cliente PostgreSQL.
 * @param fieldId - `id` da definição.
 */
export async function deleteCustomFieldDef(client: PoolClient, fieldId: string): Promise<void> {
  await client.query(`DELETE FROM core.custom_field_defs WHERE id = $1`, [fieldId]);
}

/** Valor de um campo personalizado de um contato (com metadados da definição). */
export interface CustomFieldValue {
  field_id: string;
  name: string;
  data_type: CustomFieldDataType;
  value: unknown;
}

/**
 * Lista os valores de campos personalizados de um contato, já com o nome e o
 * tipo da definição (para renderização na UI).
 *
 * @param client - Cliente PostgreSQL.
 * @param contactId - `contact_id`.
 * @returns Os valores do contato.
 */
export async function listContactCustomFieldValues(
  client: PoolClient,
  contactId: string,
): Promise<CustomFieldValue[]> {
  const { rows } = await client.query<CustomFieldValue>(
    `SELECT d.id AS field_id, d.name, d.data_type, v.value
     FROM core.contact_custom_field_values v
     JOIN core.custom_field_defs d ON d.id = v.field_id
     WHERE v.contact_id = $1
     ORDER BY d.name`,
    [contactId],
  );
  return rows;
}

/**
 * Remove o valor de um campo personalizado de um contato.
 *
 * @param client - Cliente PostgreSQL.
 * @param contactId - `contact_id`.
 * @param fieldId - `id` da definição.
 */
export async function clearCustomFieldValue(
  client: PoolClient,
  contactId: string,
  fieldId: string,
): Promise<void> {
  await client.query(
    `DELETE FROM core.contact_custom_field_values WHERE contact_id = $1 AND field_id = $2`,
    [contactId, fieldId],
  );
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
  entity: CustomFieldEntity = DEFAULT_CUSTOM_FIELD_ENTITY,
): Promise<CustomFieldDef> {
  const trimmed = name.trim();
  if (trimmed === "" || trimmed.length > FIELD_NAME_MAX_LENGTH) {
    throw new DomainError(
      ErrorCode.CUSTOM_FIELD_INVALID_NAME,
      `O nome do campo deve ter de 1 a ${FIELD_NAME_MAX_LENGTH} caracteres.`,
      { max_length: FIELD_NAME_MAX_LENGTH },
    );
  }

  // Unicidade do nome é por entidade (dois módulos podem ter "origem").
  const existing = await client.query<{ id: string }>(
    `SELECT id FROM core.custom_field_defs WHERE entity = $1 AND name = $2 LIMIT 1`,
    [entity, trimmed],
  );
  if (existing.rows[0]) {
    throw new DomainError(
      ErrorCode.CUSTOM_FIELD_DUPLICATE_NAME,
      "Já existe um campo personalizado com este nome nesta entidade.",
      { existing_field_id: existing.rows[0].id },
    );
  }

  const { rows } = await client.query<CustomFieldDef>(
    `INSERT INTO core.custom_field_defs (name, data_type, entity)
     VALUES ($1, $2, $3)
     RETURNING id, name, data_type, entity, created_at`,
    [trimmed, dataType, entity],
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

// ---------------------------------------------------------------------------
// Valores de campos personalizados de entidades genéricas (não-contato).
//
// Contatos usam contact_custom_field_values (FK forte + cascata). As demais
// entidades (oportunidades do CRM, tarefas de Projetos, ...) usam a tabela
// genérica core.entity_custom_field_values, chaveada por (entity, entity_id).
// ---------------------------------------------------------------------------

/**
 * Lista os valores de campos personalizados de um registro de uma entidade
 * genérica, com o nome e o tipo da definição. Inclui as definições sem valor
 * atribuído (value = null) para a UI renderizar todos os campos disponíveis.
 *
 * @param client - Cliente PostgreSQL.
 * @param entity - Entidade dona dos campos.
 * @param entityId - `id` do registro.
 * @returns Um item por definição da entidade, com o valor (ou null).
 */
export async function listEntityCustomFieldValues(
  client: PoolClient,
  entity: CustomFieldEntity,
  entityId: string,
): Promise<CustomFieldValue[]> {
  const { rows } = await client.query<CustomFieldValue>(
    `SELECT d.id AS field_id, d.name, d.data_type, v.value
     FROM core.custom_field_defs d
     LEFT JOIN core.entity_custom_field_values v
       ON v.field_id = d.id AND v.entity = $1 AND v.entity_id = $2
     WHERE d.entity = $1
     ORDER BY d.name`,
    [entity, entityId],
  );
  return rows;
}

/**
 * Atribui/atualiza o valor de um campo personalizado de um registro de entidade
 * genérica, validando contra o tipo da definição e garantindo que o campo
 * pertence à entidade informada.
 *
 * @param client - Cliente PostgreSQL.
 * @param entity - Entidade dona do campo.
 * @param entityId - `id` do registro.
 * @param fieldId - `id` da definição do campo.
 * @param value - Valor a atribuir (deve conformar ao tipo).
 * @throws {DomainError} `CUSTOM_FIELD_NOT_FOUND` se o campo não existe/não é da entidade.
 * @throws {DomainError} `CUSTOM_FIELD_TYPE_MISMATCH` se o valor não conforma ao tipo.
 */
export async function setEntityCustomFieldValue(
  client: PoolClient,
  entity: CustomFieldEntity,
  entityId: string,
  fieldId: string,
  value: unknown,
): Promise<void> {
  const def = await client.query<{ data_type: CustomFieldDataType }>(
    `SELECT data_type FROM core.custom_field_defs WHERE id = $1 AND entity = $2`,
    [fieldId, entity],
  );
  const dataType = def.rows[0]?.data_type;
  if (!dataType) {
    throw new DomainError(
      ErrorCode.CUSTOM_FIELD_NOT_FOUND,
      "Campo personalizado não encontrado para esta entidade.",
      { field_id: fieldId, entity },
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
    `INSERT INTO core.entity_custom_field_values (entity, entity_id, field_id, value)
     VALUES ($1, $2, $3, $4::jsonb)
     ON CONFLICT (entity, entity_id, field_id)
     DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [entity, entityId, fieldId, JSON.stringify(value)],
  );
}

/**
 * Remove o valor de um campo personalizado de um registro de entidade genérica.
 *
 * @param client - Cliente PostgreSQL.
 * @param entity - Entidade dona do campo.
 * @param entityId - `id` do registro.
 * @param fieldId - `id` da definição do campo.
 */
export async function clearEntityCustomFieldValue(
  client: PoolClient,
  entity: CustomFieldEntity,
  entityId: string,
  fieldId: string,
): Promise<void> {
  await client.query(
    `DELETE FROM core.entity_custom_field_values
     WHERE entity = $1 AND entity_id = $2 AND field_id = $3`,
    [entity, entityId, fieldId],
  );
}
