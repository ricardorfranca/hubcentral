/**
 * @file account-service.ts
 * @module modules/crm
 *
 * Serviço de Contas (B2B) do CRM 2.0. Uma conta referencia uma empresa em
 * `core.contacts` (find-or-create por CNPJ), sem duplicar dados de contato.
 */

import type { PoolClient } from "pg";
import { DomainError, ErrorCode } from "../../core/errors.js";
import { findOrCreateCompany } from "../../core/contacts/contact-service.js";
import type { CompanyRegistrationFields } from "../../core/contacts/types.js";
import { registerReference } from "../../core/contacts/reference-service.js";
import { log as auditLog } from "../../core/audit/audit-logger.js";

/** Conta como persistida em `mod_crm.accounts`. */
export interface Account {
  id: string;
  company_contact_id: string;
  segment: string | null;
  size_tier: string | null;
  owner_user_id: string | null;
}

/** Remove qualquer caractere não numérico do CNPJ. */
function normalizeCnpj(cnpj: string): string {
  return cnpj.replace(/\D/g, "");
}

/** Valida o CNPJ pelo comprimento (14 dígitos). */
function isValidCnpj(cnpj: string): boolean {
  return normalizeCnpj(cnpj).length === 14;
}

/**
 * Cria (ou reusa) uma Conta a partir de razão social + CNPJ. Faz find-or-create
 * da empresa em `core.contacts` e registra a referência do módulo. Se já existir
 * conta para a empresa, retorna a existente (idempotente por empresa).
 *
 * Os dados cadastrais oficiais (`company`) só são aplicados quando a empresa é
 * CRIADA agora. Se ela já existe na Base Central, o cadastro dela é preservado —
 * o CRM não sobrescreve dados do núcleo.
 *
 * @param client - Cliente PostgreSQL.
 * @param input - Dados da conta (razão social, CNPJ, comerciais) e cadastrais da empresa.
 * @param actorUserId - Autor.
 * @returns A conta criada ou existente.
 * @throws {DomainError} `CRM_INVALID_CNPJ` se o CNPJ for inválido.
 */
export async function createAccount(
  client: PoolClient,
  input: {
    legalName: string;
    cnpj: string;
    segment?: string | undefined;
    sizeTier?: string | undefined;
    ownerUserId?: string | undefined;
    /** Dados cadastrais oficiais da empresa (autofill por CNPJ), se houver. */
    company?: CompanyRegistrationFields | undefined;
  },
  actorUserId: string | null = null,
): Promise<Account> {
  if (!isValidCnpj(input.cnpj)) {
    throw new DomainError(ErrorCode.CRM_INVALID_CNPJ, "CNPJ inválido (esperado 14 dígitos).", {
      cnpj: input.cnpj,
    });
  }
  const cnpj = normalizeCnpj(input.cnpj);

  // Empresa na Base Central (fonte de verdade); find-or-create por documento.
  const companyId = await findOrCreateCompany(
    client,
    { ...(input.company ?? {}), legal_name: input.legalName, fiscal_document: cnpj },
    actorUserId,
  );
  await registerReference(client, "mod_crm", "accounts", companyId);

  // Reusa a conta se já existir para essa empresa.
  const existing = await client.query<Account>(
    `SELECT id, company_contact_id, segment, size_tier, owner_user_id
     FROM mod_crm.accounts WHERE company_contact_id = $1`,
    [companyId],
  );
  if (existing.rows[0]) {
    return existing.rows[0];
  }

  const { rows } = await client.query<Account>(
    `INSERT INTO mod_crm.accounts (company_contact_id, segment, size_tier, owner_user_id)
     VALUES ($1, $2, $3, $4)
     RETURNING id, company_contact_id, segment, size_tier, owner_user_id`,
    [companyId, input.segment ?? null, input.sizeTier ?? null, input.ownerUserId ?? null],
  );
  const account = rows[0] as Account;

  await auditLog(client, {
    userId: actorUserId,
    module: "crm",
    action: "CRM_CONTA_CRIADA",
    payloadAfter: { account_id: account.id, company_contact_id: companyId },
  });

  return account;
}

/**
 * Vincula um contato (pessoa) a uma conta, com papel. Idempotente.
 *
 * @param client - Cliente PostgreSQL.
 * @param accountId - `id` da conta.
 * @param personContactId - `contact_id` da pessoa (core.contacts).
 * @param role - Papel na conta (decisor/influenciador/tecnico).
 */
export async function linkContact(
  client: PoolClient,
  accountId: string,
  personContactId: string,
  role?: string,
): Promise<void> {
  await registerReference(client, "mod_crm", "account_contacts", personContactId);
  await client.query(
    `INSERT INTO mod_crm.account_contacts (account_id, person_contact_id, role)
     VALUES ($1, $2, $3)
     ON CONFLICT (account_id, person_contact_id) DO UPDATE SET role = EXCLUDED.role`,
    [accountId, personContactId, role ?? null],
  );
}

/** Conta com dados da empresa resolvidos da Base Central. */
export interface AccountView extends Account {
  legal_name: string | null;
  cnpj: string | null;
  contacts: { person_contact_id: string; full_name: string | null; role: string | null }[];
}

/**
 * Lista as contas com razão social/CNPJ resolvidos da Base Central.
 *
 * @param client - Cliente PostgreSQL.
 * @returns Lista de contas com dados da empresa.
 */
export async function listAccounts(
  client: PoolClient,
): Promise<(Account & { legal_name: string | null; cnpj: string | null })[]> {
  const { rows } = await client.query<Account & { legal_name: string | null; cnpj: string | null }>(
    `SELECT a.id, a.company_contact_id, a.segment, a.size_tier, a.owner_user_id,
            c.legal_name, c.fiscal_document AS cnpj
     FROM mod_crm.accounts a
     JOIN core.contacts c ON c.id = a.company_contact_id
     ORDER BY c.legal_name`,
  );
  return rows;
}

/**
 * Retorna uma conta com empresa e contatos vinculados resolvidos.
 *
 * @param client - Cliente PostgreSQL.
 * @param accountId - `id` da conta.
 * @returns A visão da conta, ou `null` se não existe.
 */
export async function getAccount(client: PoolClient, accountId: string): Promise<AccountView | null> {
  const { rows } = await client.query<Account & { legal_name: string | null; cnpj: string | null }>(
    `SELECT a.id, a.company_contact_id, a.segment, a.size_tier, a.owner_user_id,
            c.legal_name, c.fiscal_document AS cnpj
     FROM mod_crm.accounts a
     JOIN core.contacts c ON c.id = a.company_contact_id
     WHERE a.id = $1`,
    [accountId],
  );
  const account = rows[0];
  if (!account) {
    return null;
  }
  const contacts = await client.query<{ person_contact_id: string; full_name: string | null; role: string | null }>(
    `SELECT ac.person_contact_id, p.full_name, ac.role
     FROM mod_crm.account_contacts ac
     JOIN core.contacts p ON p.id = ac.person_contact_id
     WHERE ac.account_id = $1`,
    [accountId],
  );
  return { ...account, contacts: contacts.rows };
}
