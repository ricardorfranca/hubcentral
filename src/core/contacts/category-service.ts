/**
 * @file category-service.ts
 * @module core/contacts
 *
 * Serviço de categorias de contato (Req 3). Gerencia as categorias de sistema
 * e customizadas, associa categorias a contatos e consulta contatos por
 * categoria.
 */

import type { PoolClient } from "pg";
import { DomainError, ErrorCode } from "../errors.js";

/** Nomes das 5 categorias de sistema (Req 3.1). */
export const SYSTEM_CATEGORIES = [
  "lead_frio",
  "cliente_ativo",
  "cliente_inativo",
  "fornecedor_ativo",
  "fornecedor_inativo",
] as const;

/** Categoria de contato como persistida em `core.contact_categories`. */
export interface ContactCategory {
  id: string;
  name: string;
  is_system: boolean;
  created_at: Date;
}

/** Tamanho máximo do nome de uma categoria. */
const CATEGORY_NAME_MAX_LENGTH = 100;

/**
 * Cria uma categoria customizada (Req 3.3). Rejeita nome duplicado — a
 * comparação é case-insensitive porque `name` é CITEXT (Req 3.5).
 *
 * @param client - Cliente PostgreSQL.
 * @param name - Nome da categoria (1..100 caracteres).
 * @returns A categoria criada, com `is_system = false`.
 * @throws {DomainError} `CATEGORY_INVALID_NAME` se o nome for vazio/em branco ou exceder o limite.
 * @throws {DomainError} `CATEGORY_DUPLICATE_NAME` se já existir categoria com o mesmo nome (Req 3.5).
 */
export async function createCustomCategory(
  client: PoolClient,
  name: string,
): Promise<ContactCategory> {
  const trimmed = name.trim();
  if (trimmed === "" || trimmed.length > CATEGORY_NAME_MAX_LENGTH) {
    throw new DomainError(
      ErrorCode.CATEGORY_INVALID_NAME,
      `O nome da categoria deve ter de 1 a ${CATEGORY_NAME_MAX_LENGTH} caracteres.`,
      { max_length: CATEGORY_NAME_MAX_LENGTH },
    );
  }

  // Pré-checagem para mensagem descritiva (Req 3.5); o UNIQUE é a rede de segurança.
  const existing = await client.query<{ id: string }>(
    `SELECT id FROM core.contact_categories WHERE name = $1 LIMIT 1`,
    [trimmed],
  );
  if (existing.rows[0]) {
    throw new DomainError(
      ErrorCode.CATEGORY_DUPLICATE_NAME,
      "Já existe uma categoria com este nome.",
      { existing_category_id: existing.rows[0].id },
    );
  }

  const { rows } = await client.query<ContactCategory>(
    `INSERT INTO core.contact_categories (name, is_system)
     VALUES ($1, false)
     RETURNING id, name, is_system, created_at`,
    [trimmed],
  );
  return rows[0] as ContactCategory;
}

/**
 * Lista todas as categorias disponíveis (sistema + customizadas), ordenadas
 * por nome (Req 3.3).
 *
 * @param client - Cliente PostgreSQL.
 * @returns Lista de categorias.
 */
export async function listCategories(client: PoolClient): Promise<ContactCategory[]> {
  const { rows } = await client.query<ContactCategory>(
    `SELECT id, name, is_system, created_at FROM core.contact_categories ORDER BY name`,
  );
  return rows;
}

/**
 * Associa uma categoria a um contato (Req 3.2). Idempotente: associar uma
 * categoria já associada não gera erro nem duplica a associação.
 *
 * @param client - Cliente PostgreSQL.
 * @param contactId - `contact_id` do contato.
 * @param categoryId - `id` da categoria.
 */
export async function assignCategory(
  client: PoolClient,
  contactId: string,
  categoryId: string,
): Promise<void> {
  await client.query(
    `INSERT INTO core.contact_category_assignments (contact_id, category_id)
     VALUES ($1, $2)
     ON CONFLICT (contact_id, category_id) DO NOTHING`,
    [contactId, categoryId],
  );
}

/**
 * Retorna os `contact_id` dos contatos associados a QUALQUER uma das categorias
 * informadas (Req 3.6). Sem duplicatas.
 *
 * @param client - Cliente PostgreSQL.
 * @param categoryIds - Lista de `id` de categorias a filtrar.
 * @returns Lista de `contact_id` distintos (vazia se `categoryIds` for vazio).
 */
export async function listContactsByCategory(
  client: PoolClient,
  categoryIds: readonly string[],
): Promise<string[]> {
  if (categoryIds.length === 0) {
    return [];
  }
  const { rows } = await client.query<{ contact_id: string }>(
    `SELECT DISTINCT contact_id FROM core.contact_category_assignments
     WHERE category_id = ANY($1::uuid[])`,
    [categoryIds as string[]],
  );
  return rows.map((r) => r.contact_id);
}
