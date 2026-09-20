/**
 * @file reference-service.ts
 * @module core/contacts
 *
 * ReferenceService — registro e verificação de referências de módulo a
 * contatos (Req 7). Sustenta o princípio "referenciar sem duplicar": módulos
 * guardam apenas `contact_id` e registram a referência aqui.
 */

import type { PoolClient } from "pg";
import { DomainError, ErrorCode } from "../errors.js";

/**
 * Registra uma referência de um módulo a um contato (Req 7.1). Idempotente:
 * registrar a mesma referência duas vezes não gera erro nem duplica.
 *
 * @param client - Cliente PostgreSQL.
 * @param module - Nome do módulo (ex.: `mod_crm`).
 * @param tableName - Tabela do módulo que referencia (ex.: `leads`).
 * @param contactId - `contact_id` referenciado.
 * @throws {DomainError} `REFERENCE_CONTACT_NOT_FOUND` se o contato não existe (Req 7.4).
 */
export async function registerReference(
  client: PoolClient,
  module: string,
  tableName: string,
  contactId: string,
): Promise<void> {
  const exists = await contactExists(client, contactId);
  if (!exists) {
    throw new DomainError(
      ErrorCode.REFERENCE_CONTACT_NOT_FOUND,
      "Não é possível referenciar um contato inexistente.",
      { contact_id: contactId },
    );
  }

  await client.query(
    `INSERT INTO core.contact_references (module, table_name, contact_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (module, table_name, contact_id) DO NOTHING`,
    [module, tableName, contactId],
  );
}

/**
 * Remove uma referência previamente registrada, se existir.
 *
 * @param client - Cliente PostgreSQL.
 * @param module - Nome do módulo.
 * @param tableName - Tabela do módulo.
 * @param contactId - `contact_id` referenciado.
 * @returns `true` se removeu; `false` se a referência não existia.
 */
export async function removeReference(
  client: PoolClient,
  module: string,
  tableName: string,
  contactId: string,
): Promise<boolean> {
  const { rowCount } = await client.query(
    `DELETE FROM core.contact_references
     WHERE module = $1 AND table_name = $2 AND contact_id = $3`,
    [module, tableName, contactId],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * Lista os módulos DISTINTOS que referenciam um contato (Req 7.5).
 *
 * @param client - Cliente PostgreSQL.
 * @param contactId - `contact_id` a inspecionar.
 * @returns Lista de nomes de módulo (sem duplicatas), possivelmente vazia.
 */
export async function listModulesReferencing(
  client: PoolClient,
  contactId: string,
): Promise<string[]> {
  const { rows } = await client.query<{ module: string }>(
    `SELECT DISTINCT module FROM core.contact_references
     WHERE contact_id = $1 ORDER BY module`,
    [contactId],
  );
  return rows.map((r) => r.module);
}

/**
 * Indica se um contato possui ao menos uma referência ativa de módulo (Req 7.5).
 *
 * @param client - Cliente PostgreSQL.
 * @param contactId - `contact_id` a inspecionar.
 * @returns `true` se existe ao menos uma referência.
 */
export async function hasActiveReferences(
  client: PoolClient,
  contactId: string,
): Promise<boolean> {
  const { rows } = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM core.contact_references WHERE contact_id = $1
     ) AS exists`,
    [contactId],
  );
  return rows[0]?.exists ?? false;
}

/**
 * Verifica a existência de um contato.
 *
 * @param client - Cliente PostgreSQL.
 * @param contactId - `contact_id` a verificar.
 * @returns `true` se o contato existe.
 */
async function contactExists(client: PoolClient, contactId: string): Promise<boolean> {
  const { rows } = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM core.contacts WHERE id = $1) AS exists`,
    [contactId],
  );
  return rows[0]?.exists ?? false;
}
