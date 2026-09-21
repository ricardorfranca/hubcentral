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

/**
 * Vocabulário canônico de papéis da pessoa na empresa. A coluna `role` segue
 * sendo TEXT livre (compatibilidade com vínculos legados e com outros módulos);
 * este conjunto é o que a interface e as rotas HTTP oferecem.
 */
export const COMPANY_PERSON_ROLES = [
  "principal",
  "tecnico",
  "portabilidade",
  "extra",
] as const;

/** Um papel do vocabulário canônico. */
export type CompanyPersonRole = (typeof COMPANY_PERSON_ROLES)[number];

/** Papel que só pode existir uma vez por empresa (responsável principal). */
const UNIQUE_ROLE: CompanyPersonRole = "principal";

/**
 * Indica se um papel pertence ao vocabulário canônico.
 *
 * @param role - Papel informado.
 * @returns `true` se for um dos {@link COMPANY_PERSON_ROLES}.
 */
export function isCompanyPersonRole(role: string): role is CompanyPersonRole {
  return (COMPANY_PERSON_ROLES as readonly string[]).includes(role);
}

/** Vínculo empresa↔pessoa como persistido em `core.contact_company_links`. */
export interface CompanyPersonLink {
  id: string;
  company_id: string;
  person_id: string;
  role: string | null;
  created_at: Date;
}

/** Pessoa vinculada a uma empresa, com os dados resolvidos do núcleo. */
export interface CompanyPerson {
  /** `contact_id` da pessoa. */
  person_id: string;
  role: string | null;
  full_name: string | null;
  email: string | null;
  phone: string | null;
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

  // O responsável principal é único por empresa (índice uq_ccl_company_principal).
  await assertPrincipalAvailable(client, companyId, normalizedRole, null);

  const { rows } = await client.query<CompanyPersonLink>(
    `INSERT INTO core.contact_company_links (company_id, person_id, role)
     VALUES ($1, $2, $3)
     RETURNING id, company_id, person_id, role, created_at`,
    [companyId, personId, normalizedRole],
  );
  return rows[0] as CompanyPersonLink;
}

/**
 * Altera o papel de um vínculo existente empresa↔pessoa.
 *
 * @param client - Cliente PostgreSQL.
 * @param companyId - `contact_id` da empresa.
 * @param personId - `contact_id` da pessoa.
 * @param role - Novo papel, ou `null`/vazio para remover o papel.
 * @returns O vínculo atualizado.
 * @throws {DomainError} `LINK_INVALID_ROLE` se o papel exceder 100 caracteres.
 * @throws {DomainError} `LINK_PRINCIPAL_EXISTS` se a empresa já tiver outro responsável principal.
 * @throws {DomainError} `CONTACT_NOT_FOUND` se o vínculo não existir.
 */
export async function setLinkRole(
  client: PoolClient,
  companyId: string,
  personId: string,
  role: string | null,
): Promise<CompanyPersonLink> {
  let normalizedRole: string | null = null;
  if (role != null && role.trim() !== "") {
    if (role.length > ROLE_MAX_LENGTH) {
      throw new DomainError(
        ErrorCode.LINK_INVALID_ROLE,
        `O papel deve ter no máximo ${ROLE_MAX_LENGTH} caracteres.`,
        { max_length: ROLE_MAX_LENGTH },
      );
    }
    normalizedRole = role;
  }

  await assertPrincipalAvailable(client, companyId, normalizedRole, personId);

  const { rows } = await client.query<CompanyPersonLink>(
    `UPDATE core.contact_company_links SET role = $3
     WHERE company_id = $1 AND person_id = $2
     RETURNING id, company_id, person_id, role, created_at`,
    [companyId, personId, normalizedRole],
  );
  const updated = rows[0];
  if (!updated) {
    throw new DomainError(ErrorCode.CONTACT_NOT_FOUND, "Vínculo empresa↔pessoa não encontrado.", {
      company_id: companyId,
      person_id: personId,
    });
  }
  return updated;
}

/**
 * Lista as pessoas vinculadas a uma empresa, com nome/e-mail/telefone
 * resolvidos do núcleo (Req 2.2, 7.3). O responsável principal vem primeiro.
 *
 * @param client - Cliente PostgreSQL.
 * @param companyId - `contact_id` da empresa.
 * @returns As pessoas vinculadas (possivelmente vazio).
 */
export async function listPeopleOfCompany(
  client: PoolClient,
  companyId: string,
): Promise<CompanyPerson[]> {
  const { rows } = await client.query<CompanyPerson>(
    `SELECT l.person_id, l.role, l.created_at,
            p.full_name, p.email, p.phone
     FROM core.contact_company_links l
     JOIN core.contacts p ON p.id = l.person_id
     WHERE l.company_id = $1
     ORDER BY (l.role = $2) DESC, l.role NULLS LAST, p.full_name`,
    [companyId, UNIQUE_ROLE],
  );
  return rows;
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
 * Garante que a empresa não tenha outro responsável principal, quando o papel
 * pretendido é `principal`. Espelha o índice único parcial
 * `uq_ccl_company_principal` para produzir um erro de domínio legível em vez de
 * uma violação crua de constraint.
 *
 * @param client - Cliente PostgreSQL.
 * @param companyId - `contact_id` da empresa.
 * @param role - Papel pretendido (`null` ou outro papel não exige checagem).
 * @param exceptPersonId - Pessoa a ignorar na checagem (ela mesma, ao reatribuir).
 * @throws {DomainError} `LINK_PRINCIPAL_EXISTS` se já houver outro principal.
 */
async function assertPrincipalAvailable(
  client: PoolClient,
  companyId: string,
  role: string | null,
  exceptPersonId: string | null,
): Promise<void> {
  if (role !== UNIQUE_ROLE) return;

  const { rows } = await client.query<{ person_id: string }>(
    `SELECT person_id FROM core.contact_company_links
     WHERE company_id = $1 AND role = $2 AND ($3::uuid IS NULL OR person_id <> $3)
     LIMIT 1`,
    [companyId, UNIQUE_ROLE, exceptPersonId],
  );
  if (rows[0]) {
    throw new DomainError(
      ErrorCode.LINK_PRINCIPAL_EXISTS,
      "Esta empresa já possui um responsável principal. Altere o papel do contato atual antes.",
      { company_id: companyId, current_principal_person_id: rows[0].person_id },
    );
  }
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
