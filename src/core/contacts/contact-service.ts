/**
 * @file contact-service.ts
 * @module core/contacts
 *
 * ContactService — operações da Base Central de Contatos. Nesta tarefa (2.2)
 * implementa a criação de contato com validação e deduplicação (Req 1, 5.1–5.4).
 * Demais operações (vínculos, categorias, campos, mesclagem, exclusão) são
 * adicionadas nas tarefas seguintes.
 */

import type { PoolClient } from "pg";
import { DomainError, ErrorCode } from "../errors.js";
import type { Contact, ContactInput } from "./types.js";
import { firstMissingRequiredField, isValidEmail } from "./validation.js";
import { hasActiveReferences, listModulesReferencing } from "./reference-service.js";
import { log as auditLog } from "../audit/audit-logger.js";
import { publish, buildEnvelope } from "../events/event-bus.js";

/** Colunas retornadas ao materializar um {@link Contact}. */
const CONTACT_COLUMNS =
  "id, contact_type, full_name, email, phone, legal_name, fiscal_document, merged_into, created_at, updated_at";

/**
 * Cria um contato na Base Central de Contatos, aplicando validação de campos
 * obrigatórios por tipo (Req 1.3, 1.4, 1.6), validação de e-mail (Req 1.5) e
 * deduplicação por chave natural (Req 5.1–5.4).
 *
 * A pré-checagem de duplicidade roda no serviço para poder retornar o
 * `contact_id` do contato existente na mensagem de erro (Req 5.2, 5.4); o
 * índice único parcial da tabela é a rede de segurança contra corrida.
 *
 * @param client - Cliente PostgreSQL (permite operar dentro de uma transação).
 * @param input - Dados do contato a criar (pessoa ou empresa).
 * @returns O contato criado, com `id` UUID gerado (Req 1.1).
 * @throws {DomainError} `CONTACT_MISSING_FIELD` se faltar campo obrigatório (Req 1.6).
 * @throws {DomainError} `CONTACT_INVALID_EMAIL` se o e-mail for inválido (Req 1.5).
 * @throws {DomainError} `CONTACT_DUPLICATE_EMAIL` se já existir pessoa com o e-mail (Req 5.1, 5.2).
 * @throws {DomainError} `CONTACT_DUPLICATE_DOCUMENT` se já existir empresa com o documento (Req 5.3, 5.4).
 */
export async function createContact(
  client: PoolClient,
  input: ContactInput,
  actorUserId: string | null = null,
): Promise<Contact> {
  // 1) Campos obrigatórios por tipo (Req 1.3, 1.4, 1.6)
  const missing = firstMissingRequiredField(input);
  if (missing) {
    throw new DomainError(
      ErrorCode.CONTACT_MISSING_FIELD,
      `Campo obrigatório ausente: ${missing}.`,
      { field: missing },
    );
  }

  // 2) Validação de e-mail para pessoa (Req 1.5)
  if (input.contact_type === "pessoa" && !isValidEmail(input.email)) {
    throw new DomainError(
      ErrorCode.CONTACT_INVALID_EMAIL,
      "E-mail em formato inválido.",
      { email: input.email },
    );
  }

  // 3) Deduplicação por chave natural (Req 5.1–5.4)
  if (input.contact_type === "pessoa") {
    const existing = await findActivePersonByEmail(client, input.email);
    if (existing) {
      throw new DomainError(
        ErrorCode.CONTACT_DUPLICATE_EMAIL,
        "Já existe um contato pessoa com este e-mail.",
        { existing_contact_id: existing },
      );
    }
  } else {
    const existing = await findActiveCompanyByDocument(client, input.fiscal_document);
    if (existing) {
      throw new DomainError(
        ErrorCode.CONTACT_DUPLICATE_DOCUMENT,
        "Já existe um contato empresa com este documento fiscal.",
        { existing_contact_id: existing },
      );
    }
  }

  // 4) Inserção
  const insert =
    input.contact_type === "pessoa"
      ? {
          text: `INSERT INTO core.contacts (contact_type, full_name, email, phone)
                 VALUES ('pessoa', $1, $2, $3) RETURNING ${CONTACT_COLUMNS}`,
          params: [input.full_name, input.email, input.phone],
        }
      : {
          text: `INSERT INTO core.contacts (contact_type, legal_name, fiscal_document)
                 VALUES ('empresa', $1, $2) RETURNING ${CONTACT_COLUMNS}`,
          params: [input.legal_name, input.fiscal_document],
        };

  const { rows } = await client.query<Contact>(insert.text, insert.params);
  // O RETURNING garante exatamente uma linha; a asserção reflete essa invariante.
  const created = rows[0] as Contact;

  // Auditoria de criação (Req 1.7): estado anterior nulo, novo = contato criado.
  await auditLog(client, {
    userId: actorUserId,
    module: "core",
    action: "CONTATO_CRIADO",
    payloadAfter: created,
  });

  return created;
}

/** Contato com rótulos (categorias) resolvidos, para listagem. */
export interface ContactListItem extends Contact {
  labels: { id: string; name: string }[];
}

/**
 * Lista contatos ativos (não mesclados), com seus rótulos, opcionalmente
 * filtrados por tipo e por texto (nome/e-mail/razão social/documento).
 *
 * @param client - Cliente PostgreSQL.
 * @param options - `type` (pessoa|empresa), `search` (texto), `limit` (default 200).
 * @returns Contatos com rótulos, ordenados por nome.
 */
export async function listContacts(
  client: PoolClient,
  options: { type?: "pessoa" | "empresa" | undefined; search?: string | undefined; limit?: number | undefined } = {},
): Promise<ContactListItem[]> {
  const params: unknown[] = [];
  const where: string[] = ["c.merged_into IS NULL"];
  if (options.type) {
    params.push(options.type);
    where.push(`c.contact_type = $${params.length}`);
  }
  if (options.search && options.search.trim()) {
    params.push(`%${options.search.trim()}%`);
    const p = `$${params.length}`;
    where.push(
      `(c.full_name ILIKE ${p} OR c.email::text ILIKE ${p} OR c.legal_name ILIKE ${p} OR c.fiscal_document::text ILIKE ${p} OR c.phone ILIKE ${p})`,
    );
  }
  params.push(options.limit ?? 200);
  const limitParam = `$${params.length}`;

  const { rows } = await client.query<ContactListItem>(
    `SELECT ${CONTACT_COLUMNS.split(", ").map((col) => `c.${col}`).join(", ")},
            COALESCE(
              (SELECT json_agg(json_build_object('id', cat.id, 'name', cat.name) ORDER BY cat.name)
               FROM core.contact_category_assignments a
               JOIN core.contact_categories cat ON cat.id = a.category_id
               WHERE a.contact_id = c.id),
              '[]'::json
            ) AS labels
     FROM core.contacts c
     WHERE ${where.join(" AND ")}
     ORDER BY COALESCE(c.full_name, c.legal_name)
     LIMIT ${limitParam}`,
    params,
  );
  return rows;
}

/** Campos de contato que podem ser atualizados. */
export interface ContactPatch {
  full_name?: string;
  email?: string;
  phone?: string;
  legal_name?: string;
  fiscal_document?: string;
}

/**
 * Atualiza dados de um contato (Req 1.7, 12.4). Grava auditoria com estado
 * anterior/novo e publica o evento `core.contato.atualizado` no outbox, na
 * mesma transação (Req 12.4).
 *
 * @param client - Cliente PostgreSQL (deve rodar em transação).
 * @param id - `contact_id` a atualizar.
 * @param patch - Campos a alterar (apenas os presentes são atualizados).
 * @param actorUserId - Autor da alteração, ou `null` para SYSTEM.
 * @returns O contato atualizado.
 * @throws {DomainError} `CONTACT_NOT_FOUND` se o contato não existe.
 * @throws {DomainError} `CONTACT_INVALID_EMAIL` se o novo e-mail for inválido (Req 1.5).
 */
export async function updateContact(
  client: PoolClient,
  id: string,
  patch: ContactPatch,
  actorUserId: string | null = null,
): Promise<Contact> {
  const before = await getContactData(client, id);
  if (!before) {
    throw new DomainError(ErrorCode.CONTACT_NOT_FOUND, "Contato não encontrado.", {
      contact_id: id,
    });
  }

  if (patch.email !== undefined && !isValidEmail(patch.email)) {
    throw new DomainError(ErrorCode.CONTACT_INVALID_EMAIL, "E-mail em formato inválido.", {
      email: patch.email,
    });
  }

  // Monta o UPDATE dinâmico apenas com os campos presentes no patch.
  const columns = ["full_name", "email", "phone", "legal_name", "fiscal_document"] as const;
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const col of columns) {
    const value = patch[col];
    if (value !== undefined) {
      params.push(value);
      sets.push(`${col} = $${params.length}`);
    }
  }

  let after = before;
  if (sets.length > 0) {
    params.push(id);
    const { rows } = await client.query<Contact>(
      `UPDATE core.contacts SET ${sets.join(", ")}, updated_at = now()
       WHERE id = $${params.length}
       RETURNING ${CONTACT_COLUMNS}`,
      params,
    );
    after = rows[0] as Contact;
  }

  // Auditoria (Req 1.7).
  await auditLog(client, {
    userId: actorUserId,
    module: "core",
    action: "CONTATO_ATUALIZADO",
    payloadBefore: before,
    payloadAfter: after,
  });

  // Evento com apenas a referência do contato (Req 12.3, 12.4).
  await publish(
    client,
    buildEnvelope("core.contato.atualizado", "core", { contact_id: id }),
  );

  return after;
}

/** Resultado de uma mesclagem de contatos. */
export interface MergeResult {
  /** `contact_id` do contato de destino (sobrevivente). */
  target_id: string;
  /** `contact_id` do contato de origem (marcado como mesclado). */
  source_id: string;
}

/**
 * Mescla dois contatos do mesmo tipo (Req 5.5). Transfere para o destino todos
 * os vínculos empresa↔pessoa, categorias, valores de campo personalizado e
 * referências de módulo da origem, sem perder nem duplicar; em seguida marca a
 * origem como mesclada (`merged_into = target`).
 *
 * A transferência é idempotente por conflito: itens já presentes no destino
 * são mantidos (a origem não sobrescreve o destino).
 *
 * @param client - Cliente PostgreSQL (deve rodar em transação para atomicidade).
 * @param sourceId - `contact_id` de origem (será mesclado no destino).
 * @param targetId - `contact_id` de destino (sobrevivente).
 * @returns Os ids de origem e destino.
 * @throws {DomainError} `CONTACT_NOT_FOUND` se origem ou destino não existem.
 * @throws {DomainError} `CONTACT_MERGE_INVALID` se forem o mesmo contato, de tipos
 *   diferentes, ou se algum já estiver mesclado (Req 5.5).
 */
export async function mergeContacts(
  client: PoolClient,
  sourceId: string,
  targetId: string,
  actorUserId: string | null = null,
): Promise<MergeResult> {
  if (sourceId === targetId) {
    throw new DomainError(
      ErrorCode.CONTACT_MERGE_INVALID,
      "Origem e destino da mesclagem não podem ser o mesmo contato.",
      { source_id: sourceId, target_id: targetId },
    );
  }

  const source = await getContactData(client, sourceId);
  const target = await getContactData(client, targetId);
  if (!source || !target) {
    throw new DomainError(ErrorCode.CONTACT_NOT_FOUND, "Contato de mesclagem não encontrado.", {
      source_id: sourceId,
      target_id: targetId,
    });
  }
  if (source.contact_type !== target.contact_type) {
    throw new DomainError(
      ErrorCode.CONTACT_MERGE_INVALID,
      "Só é possível mesclar contatos do mesmo tipo.",
      { source_type: source.contact_type, target_type: target.contact_type },
    );
  }
  if (source.merged_into !== null || target.merged_into !== null) {
    throw new DomainError(
      ErrorCode.CONTACT_MERGE_INVALID,
      "Não é possível mesclar um contato que já foi mesclado.",
      { source_id: sourceId, target_id: targetId },
    );
  }

  // Transfere vínculos empresa↔pessoa (como empresa e como pessoa).
  // ON CONFLICT evita violar a unicidade do par quando o destino já tem o vínculo.
  await client.query(
    `UPDATE core.contact_company_links SET company_id = $2
     WHERE company_id = $1
       AND NOT EXISTS (
         SELECT 1 FROM core.contact_company_links x
         WHERE x.company_id = $2 AND x.person_id = core.contact_company_links.person_id
       )`,
    [sourceId, targetId],
  );
  await client.query(
    `UPDATE core.contact_company_links SET person_id = $2
     WHERE person_id = $1
       AND NOT EXISTS (
         SELECT 1 FROM core.contact_company_links x
         WHERE x.person_id = $2 AND x.company_id = core.contact_company_links.company_id
       )`,
    [sourceId, targetId],
  );
  // Remove vínculos remanescentes da origem que colidiriam com os do destino.
  await client.query(
    `DELETE FROM core.contact_company_links WHERE company_id = $1 OR person_id = $1`,
    [sourceId],
  );

  // Transfere categorias (evita duplicar a PK composta no destino).
  await client.query(
    `INSERT INTO core.contact_category_assignments (contact_id, category_id)
     SELECT $2, category_id FROM core.contact_category_assignments WHERE contact_id = $1
     ON CONFLICT (contact_id, category_id) DO NOTHING`,
    [sourceId, targetId],
  );
  await client.query(
    `DELETE FROM core.contact_category_assignments WHERE contact_id = $1`,
    [sourceId],
  );

  // Transfere valores de campo personalizado; mantém o valor do destino em conflito.
  await client.query(
    `INSERT INTO core.contact_custom_field_values (contact_id, field_id, value)
     SELECT $2, field_id, value FROM core.contact_custom_field_values WHERE contact_id = $1
     ON CONFLICT (contact_id, field_id) DO NOTHING`,
    [sourceId, targetId],
  );
  await client.query(
    `DELETE FROM core.contact_custom_field_values WHERE contact_id = $1`,
    [sourceId],
  );

  // Transfere referências de módulo (evita duplicar a tripla única no destino).
  await client.query(
    `INSERT INTO core.contact_references (module, table_name, contact_id)
     SELECT module, table_name, $2 FROM core.contact_references WHERE contact_id = $1
     ON CONFLICT (module, table_name, contact_id) DO NOTHING`,
    [sourceId, targetId],
  );
  await client.query(
    `DELETE FROM core.contact_references WHERE contact_id = $1`,
    [sourceId],
  );

  // Marca a origem como mesclada no destino (Req 5.5).
  await client.query(
    `UPDATE core.contacts SET merged_into = $2, updated_at = now() WHERE id = $1`,
    [sourceId, targetId],
  );

  // Auditoria da mesclagem (Req 5.6): identifica origem e destino.
  await auditLog(client, {
    userId: actorUserId,
    module: "core",
    action: "CONTATO_MESCLADO",
    payloadBefore: { source_id: sourceId },
    payloadAfter: { target_id: targetId },
  });

  return { source_id: sourceId, target_id: targetId };
}

/**
 * Encontra uma pessoa ativa por e-mail ou a cria (Req 14.2, 14.3). Idempotente
 * por e-mail: chamadas repetidas com o mesmo e-mail retornam o mesmo contato.
 *
 * @param client - Cliente PostgreSQL.
 * @param data - Dados da pessoa (nome, e-mail, telefone).
 * @param actorUserId - Autor, ou `null` para SYSTEM.
 * @returns O `contact_id` (existente ou recém-criado).
 */
export async function findOrCreatePerson(
  client: PoolClient,
  data: { full_name: string; email: string; phone: string },
  actorUserId: string | null = null,
): Promise<string> {
  const existing = await findActivePersonByEmail(client, data.email);
  if (existing) {
    return existing;
  }
  const created = await createContact(
    client,
    { contact_type: "pessoa", ...data },
    actorUserId,
  );
  return created.id;
}

/**
 * Encontra uma empresa ativa por documento fiscal ou a cria (Req 14.2, 14.3).
 *
 * @param client - Cliente PostgreSQL.
 * @param data - Dados da empresa (razão social, documento fiscal).
 * @param actorUserId - Autor, ou `null` para SYSTEM.
 * @returns O `contact_id` (existente ou recém-criado).
 */
export async function findOrCreateCompany(
  client: PoolClient,
  data: { legal_name: string; fiscal_document: string },
  actorUserId: string | null = null,
): Promise<string> {
  const existing = await findActiveCompanyByDocument(client, data.fiscal_document);
  if (existing) {
    return existing;
  }
  const created = await createContact(
    client,
    { contact_type: "empresa", ...data },
    actorUserId,
  );
  return created.id;
}

/**
 * Retorna os dados de um contato pela sua referência (Req 7.3, 14.5). É a
 * porta pela qual os módulos obtêm dados de contato sem copiá-los.
 *
 * @param client - Cliente PostgreSQL.
 * @param id - `contact_id` do contato.
 * @returns O contato, ou `null` se não existir.
 */
export async function getContactData(
  client: PoolClient,
  id: string,
): Promise<Contact | null> {
  const { rows } = await client.query<Contact>(
    `SELECT ${CONTACT_COLUMNS} FROM core.contacts WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

/**
 * Exclui um contato, bloqueando a exclusão enquanto houver ao menos uma
 * referência ativa de módulo (Req 7.5). Quando bloqueada, retorna a lista de
 * módulos que referenciam o contato na mensagem de erro.
 *
 * @param client - Cliente PostgreSQL.
 * @param id - `contact_id` do contato a excluir.
 * @throws {DomainError} `CONTACT_NOT_FOUND` se o contato não existe.
 * @throws {DomainError} `CONTACT_HAS_REFERENCES` se houver referências ativas (Req 7.5).
 */
export async function deleteContact(client: PoolClient, id: string): Promise<void> {
  const contact = await getContactData(client, id);
  if (!contact) {
    throw new DomainError(ErrorCode.CONTACT_NOT_FOUND, "Contato não encontrado.", {
      contact_id: id,
    });
  }

  if (await hasActiveReferences(client, id)) {
    const modules = await listModulesReferencing(client, id);
    throw new DomainError(
      ErrorCode.CONTACT_HAS_REFERENCES,
      "Não é possível excluir um contato referenciado por módulos.",
      { contact_id: id, modules },
    );
  }

  await client.query(`DELETE FROM core.contacts WHERE id = $1`, [id]);
}

/**
 * Busca o `id` de uma pessoa ATIVA (não mesclada) com o e-mail informado.
 *
 * @param client - Cliente PostgreSQL.
 * @param email - E-mail a procurar (comparação case-insensitive via CITEXT).
 * @returns O `contact_id` existente, ou `null` se não houver.
 */
async function findActivePersonByEmail(
  client: PoolClient,
  email: string,
): Promise<string | null> {
  const { rows } = await client.query<{ id: string }>(
    `SELECT id FROM core.contacts
     WHERE contact_type = 'pessoa' AND merged_into IS NULL AND email = $1
     LIMIT 1`,
    [email],
  );
  return rows[0]?.id ?? null;
}

/**
 * Busca o `id` de uma empresa ATIVA (não mesclada) com o documento fiscal.
 *
 * @param client - Cliente PostgreSQL.
 * @param fiscalDocument - Documento fiscal (comparação case-insensitive via CITEXT).
 * @returns O `contact_id` existente, ou `null` se não houver.
 */
async function findActiveCompanyByDocument(
  client: PoolClient,
  fiscalDocument: string,
): Promise<string | null> {
  const { rows } = await client.query<{ id: string }>(
    `SELECT id FROM core.contacts
     WHERE contact_type = 'empresa' AND merged_into IS NULL AND fiscal_document = $1
     LIMIT 1`,
    [fiscalDocument],
  );
  return rows[0]?.id ?? null;
}
