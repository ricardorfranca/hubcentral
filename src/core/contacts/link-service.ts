/**
 * @file link-service.ts
 * @module core/contacts
 *
 * Serviço de vínculos empresa↔pessoa (Req 2). Associa Contato_Pessoa a
 * Contato_Empresa com papel opcional, validando o subtipo de cada lado e
 * impedindo vínculos duplicados.
 */

import type { PoolClient } from "pg";
import { DomainError, ErrorCode } from "../errors.js";

/** Tamanho máximo do papel da pessoa na empresa (Req 2.3). */
const ROLE_MAX_LENGTH = 100;

/** Vínculo empresa↔pessoa como persistido em `core.contact_company_links`. */
export interface CompanyPersonLink {
  id: string;
  company_id: string;
  person_id: string;
  role: string | null;
  created_at: Date;
}

/**
 * Vincula uma pessoa a uma empresa, com papel opcional (Req 2.1–2.5).
 *
 * @param client - Cliente PostgreSQL (permite operar em transação).
 * @param companyId - `contact_id` do Contato_Empresa.
 * @param personId - `contact_id` do Contato_Pessoa.
 * @param role - Papel da pessoa na empresa (opcional, 1..100 caracteres).
 * @returns O vínculo criado.
 * @throws {DomainError} `LINK_INVALID_COMPANY` se `companyId` não é uma empresa (Req 2.4).
 * @throws {DomainError} `LINK_INVALID_PERSON` se `personId` não é uma pessoa (Req 2.4).
 * @throws {DomainError} `LINK_INVALID_ROLE` se o papel informado excede 100 caracteres (Req 2.3).
 * @throws {DomainError} `LINK_DUPLICATE` se o par já está vinculado (Req 2.5).
 */
export async function linkCompanyPerson(
  client: PoolClient,
  companyId: string,
  personId: string,
  role?: string,
): Promise<CompanyPersonLink> {
  // Validação do papel opcional (Req 2.3). Papel ausente é permitido (Req 2.4-EARS).
  let normalizedRole: string | null = null;
  if (role !== undefined && role.trim() !== "") {
    if (role.length > ROLE_MAX_LENGTH) {
      throw new DomainError(
        ErrorCode.LINK_INVALID_ROLE,
        `O papel deve ter no máximo ${ROLE_MAX_LENGTH} caracteres.`,
        { max_length: ROLE_MAX_LENGTH },
      );
    }
    normalizedRole = role;
  }

  // Valida o subtipo de cada lado do vínculo (Req 2.4).
  await assertContactType(client, companyId, "empresa", ErrorCode.LINK_INVALID_COMPANY);
  await assertContactType(client, personId, "pessoa", ErrorCode.LINK_INVALID_PERSON);

  // Rejeita duplicidade antes de inserir, para mensagem descritiva (Req 2.5).
  const existing = await client.query<{ id: string }>(
    `SELECT id FROM core.contact_company_links
     WHERE company_id = $1 AND person_id = $2 LIMIT 1`,
    [companyId, personId],
  );
  if (existing.rows[0]) {
    throw new DomainError(
      ErrorCode.LINK_DUPLICATE,
      "Este vínculo empresa↔pessoa já existe.",
      { existing_link_id: existing.rows[0].id },
    );
  }

  const { rows } = await client.query<CompanyPersonLink>(
    `INSERT INTO core.contact_company_links (company_id, person_id, role)
     VALUES ($1, $2, $3)
     RETURNING id, company_id, person_id, role, created_at`,
    [companyId, personId, normalizedRole],
  );
  return rows[0] as CompanyPersonLink;
}

/**
 * Remove o vínculo entre uma empresa e uma pessoa, se existir.
 *
 * @param client - Cliente PostgreSQL.
 * @param companyId - `contact_id` da empresa.
 * @param personId - `contact_id` da pessoa.
 * @returns `true` se um vínculo foi removido; `false` se não existia.
 */
export async function unlinkCompanyPerson(
  client: PoolClient,
  companyId: string,
  personId: string,
): Promise<boolean> {
  const { rowCount } = await client.query(
    `DELETE FROM core.contact_company_links
     WHERE company_id = $1 AND person_id = $2`,
    [companyId, personId],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * Retorna os `contact_id` de todas as empresas às quais uma pessoa está
 * vinculada (Req 2.6). Retorna coleção vazia quando não há vínculos.
 *
 * @param client - Cliente PostgreSQL.
 * @param personId - `contact_id` da pessoa.
 * @returns Lista de `contact_id` de empresas (possivelmente vazia).
 */
export async function getCompaniesOfPerson(
  client: PoolClient,
  personId: string,
): Promise<string[]> {
  const { rows } = await client.query<{ company_id: string }>(
    `SELECT company_id FROM core.contact_company_links
     WHERE person_id = $1 ORDER BY created_at`,
    [personId],
  );
  return rows.map((r) => r.company_id);
}

/**
 * Garante que um contato existe e é do `contact_type` esperado, lançando o
 * erro fornecido caso contrário (Req 2.4).
 *
 * @param client - Cliente PostgreSQL.
 * @param contactId - `contact_id` a verificar.
 * @param expectedType - Tipo esperado (`empresa` ou `pessoa`).
 * @param code - Código de erro a lançar em caso de divergência.
 * @throws {DomainError} Com o `code` fornecido se o tipo não bate ou o contato não existe.
 */
async function assertContactType(
  client: PoolClient,
  contactId: string,
  expectedType: "empresa" | "pessoa",
  code: typeof ErrorCode.LINK_INVALID_COMPANY | typeof ErrorCode.LINK_INVALID_PERSON,
): Promise<void> {
  const { rows } = await client.query<{ contact_type: string }>(
    `SELECT contact_type FROM core.contacts WHERE id = $1`,
    [contactId],
  );
  const actual = rows[0]?.contact_type;
  if (actual !== expectedType) {
    throw new DomainError(
      code,
      `O contato ${contactId} deveria ser do tipo '${expectedType}'.`,
      { contact_id: contactId, expected_type: expectedType, actual_type: actual ?? null },
    );
  }
}
