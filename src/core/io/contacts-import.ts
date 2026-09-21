/**
 * @file contacts-import.ts
 * @module core/io
 *
 * Serviço do Assistente de Importação de Contatos. Traduz linhas genéricas
 * (`IoRecord`) — vindas de CSV/XLSX/JSON — em operações sobre a Base Central de
 * Contatos, segundo um MAPEAMENTO de colunas fornecido pelo assistente:
 *
 *  - cada coluna do arquivo pode ser mapeada para um campo padrão do contato
 *    (nome, e-mail, telefone, razão social, documento fiscal),
 *  - ou para um campo personalizado existente / a criar,
 *  - ou ser ignorada;
 *  - todos os registros importados podem receber um ou mais rótulos.
 *
 * Cada linha é validada e persistida individualmente: linhas inválidas são
 * rejeitadas com o motivo, sem abortar a importação (Req 11.6). Duplicatas são
 * tratadas conforme a estratégia escolhida (pular ou atualizar).
 */

import type { PoolClient } from "pg";
import { DomainError, ErrorCode } from "../errors.js";
import type { IoRecord } from "./formats.js";
import {
  createContact,
  updateContact,
  getContactData,
} from "../contacts/contact-service.js";
import {
  defineCustomField,
  setCustomFieldValue,
  listCustomFieldDefs,
  isValueOfType,
  type CustomFieldDataType,
  type CustomFieldDef,
} from "../contacts/custom-field-service.js";
import { assignCategory } from "../contacts/category-service.js";
import { log as auditLog } from "../audit/audit-logger.js";

/** Tipo de contato-alvo da importação. */
export type ImportContactType = "pessoa" | "empresa";

/**
 * Estratégia para uma linha cujo contato já existe (mesma chave natural:
 * e-mail para pessoa, documento fiscal para empresa).
 *  - `skip`: não altera o contato existente (conta como ignorado);
 *  - `update`: atualiza os campos mapeados do contato existente.
 */
export type DuplicateStrategy = "skip" | "update";

/** Campos padrão de contato que uma coluna pode alimentar. */
export type StandardField =
  | "full_name"
  | "email"
  | "phone"
  | "legal_name"
  | "fiscal_document";

/**
 * Mapeamento de uma coluna do arquivo para um destino.
 *  - `ignore`: a coluna é descartada;
 *  - `standard`: alimenta um campo padrão do contato (`field`);
 *  - `custom_existing`: alimenta um campo personalizado existente (`fieldId`);
 *  - `custom_new`: cria um campo personalizado novo (`name`, `dataType`) e o alimenta.
 */
export type ColumnMapping =
  | { column: string; target: "ignore" }
  | { column: string; target: "standard"; field: StandardField }
  | { column: string; target: "custom_existing"; fieldId: string }
  | { column: string; target: "custom_new"; name: string; dataType: CustomFieldDataType };

/** Parâmetros de uma execução de importação de contatos. */
export interface ContactsImportOptions {
  /** Tipo dos contatos a importar. */
  contactType: ImportContactType;
  /** Linhas já parseadas do arquivo. */
  rows: readonly IoRecord[];
  /** Mapeamento de cada coluna do arquivo. */
  mappings: readonly ColumnMapping[];
  /** Ids de rótulos (categorias) a aplicar a todos os importados/atualizados. */
  labelIds: readonly string[];
  /** Estratégia para contatos já existentes. */
  duplicateStrategy: DuplicateStrategy;
  /** Autor da importação (para auditoria), ou `null` para SYSTEM. */
  actorUserId: string | null;
}

/** Uma linha rejeitada, com número (1-based na planilha) e motivo. */
export interface RejectedImportRow {
  /** Número da linha no arquivo (1-based, considerando o cabeçalho como linha 1). */
  line: number;
  reason: string;
  /** A linha original, para o relatório de erros. */
  row: IoRecord;
}

/** Resultado consolidado de uma importação de contatos. */
export interface ContactsImportResult {
  /** Contatos criados. */
  created: number;
  /** Contatos existentes atualizados (estratégia `update`). */
  updated: number;
  /** Linhas ignoradas (duplicatas com estratégia `skip`). */
  skipped: number;
  /** Linhas rejeitadas por erro de validação. */
  rejected: RejectedImportRow[];
  /** Campos personalizados criados durante a importação. */
  createdFields: { id: string; name: string; data_type: CustomFieldDataType }[];
}

/** Converte um valor textual da planilha para o tipo do campo personalizado. */
function coerceCustomValue(dataType: CustomFieldDataType, raw: string): unknown {
  const value = raw.trim();
  switch (dataType) {
    case "text":
      return value;
    case "number": {
      // Aceita vírgula decimal (pt-BR) além de ponto.
      const n = Number(value.replace(/\./g, "").replace(",", "."));
      return Number.isFinite(n) ? n : Number.NaN;
    }
    case "boolean": {
      const v = value.toLowerCase();
      if (["true", "1", "sim", "yes", "y", "s", "verdadeiro"].includes(v)) return true;
      if (["false", "0", "não", "nao", "no", "n", "falso"].includes(v)) return false;
      return undefined;
    }
    case "date": {
      // Normaliza dd/mm/aaaa -> aaaa-mm-dd; mantém ISO como está.
      const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
      if (br) return `${br[3]}-${br[2]}-${br[1]}`;
      return value;
    }
    default:
      return value;
  }
}

/**
 * Resolve os mapeamentos, criando os campos personalizados marcados como
 * `custom_new` e retornando um índice imutável de destinos por coluna.
 *
 * Os campos novos são criados uma única vez (antes de iterar as linhas), o que
 * garante que a definição exista para todas as linhas e evita duplicá-la.
 */
async function resolveMappings(
  client: PoolClient,
  mappings: readonly ColumnMapping[],
  createdFields: { id: string; name: string; data_type: CustomFieldDataType }[],
): Promise<Map<string, { kind: "standard"; field: StandardField } | { kind: "custom"; def: CustomFieldDef }>> {
  const defs = await listCustomFieldDefs(client);
  const byId = new Map(defs.map((d) => [d.id, d]));
  const resolved = new Map<
    string,
    { kind: "standard"; field: StandardField } | { kind: "custom"; def: CustomFieldDef }
  >();

  for (const m of mappings) {
    if (m.target === "ignore") continue;
    if (m.target === "standard") {
      resolved.set(m.column, { kind: "standard", field: m.field });
    } else if (m.target === "custom_existing") {
      const def = byId.get(m.fieldId);
      if (!def) {
        throw new DomainError(
          ErrorCode.CUSTOM_FIELD_NOT_FOUND,
          `Campo personalizado do mapeamento não encontrado: ${m.fieldId}.`,
          { field_id: m.fieldId },
        );
      }
      resolved.set(m.column, { kind: "custom", def });
    } else {
      // custom_new: cria a definição agora (nome único case-insensitive).
      const def = await defineCustomField(client, m.name, m.dataType);
      createdFields.push({ id: def.id, name: def.name, data_type: def.data_type });
      resolved.set(m.column, { kind: "custom", def });
    }
  }
  return resolved;
}

/**
 * Executa a importação de contatos a partir de linhas já parseadas (Req 11).
 *
 * Valida e persiste cada linha isoladamente: as válidas são criadas (ou
 * atualizadas, conforme a estratégia de duplicata); as inválidas são retornadas
 * com o motivo. Cria campos personalizados marcados no mapeamento e aplica os
 * rótulos selecionados a cada contato importado/atualizado. Audita o volume.
 *
 * @param client - Cliente PostgreSQL (deve rodar em transação).
 * @param opts - Parâmetros da importação.
 * @returns Relatório com contagens e linhas rejeitadas.
 */
export async function importContacts(
  client: PoolClient,
  opts: ContactsImportOptions,
): Promise<ContactsImportResult> {
  const createdFields: ContactsImportResult["createdFields"] = [];
  const resolved = await resolveMappings(client, opts.mappings, createdFields);

  const result: ContactsImportResult = {
    created: 0,
    updated: 0,
    skipped: 0,
    rejected: [],
    createdFields,
  };

  for (let i = 0; i < opts.rows.length; i++) {
    const row = opts.rows[i]!;
    // Linha 1 é o cabeçalho; a primeira linha de dados é a 2.
    const line = i + 2;

    // Coleta os valores padrão e os personalizados desta linha.
    const std: Partial<Record<StandardField, string>> = {};
    const customValues: { def: CustomFieldDef; value: unknown; raw: string }[] = [];

    let typeMismatch: string | null = null;
    for (const [column, dest] of resolved) {
      const raw = (row[column] ?? "").trim();
      if (dest.kind === "standard") {
        if (raw !== "") std[dest.field] = raw;
      } else {
        if (raw === "") continue; // valor vazio: não define o campo personalizado
        const value = coerceCustomValue(dest.def.data_type, raw);
        if (value === undefined || !isValueOfType(dest.def.data_type, value)) {
          typeMismatch = `Coluna "${column}": valor "${raw}" incompatível com o tipo '${dest.def.data_type}' do campo "${dest.def.name}".`;
          break;
        }
        customValues.push({ def: dest.def, value, raw });
      }
    }

    if (typeMismatch) {
      result.rejected.push({ line, reason: typeMismatch, row });
      continue;
    }

    // Valida a presença dos campos obrigatórios por tipo antes de persistir.
    const missing = missingRequired(opts.contactType, std);
    if (missing) {
      result.rejected.push({ line, reason: `Campo obrigatório ausente: ${missing}.`, row });
      continue;
    }

    try {
      const outcome = await upsertContact(client, opts, std);
      if (outcome.action === "skipped") {
        result.skipped++;
        continue;
      }

      // Aplica valores de campos personalizados.
      for (const cv of customValues) {
        await setCustomFieldValue(client, outcome.contactId, cv.def.id, cv.value);
      }
      // Aplica rótulos (idempotente).
      for (const labelId of opts.labelIds) {
        await assignCategory(client, outcome.contactId, labelId);
      }

      if (outcome.action === "created") result.created++;
      else result.updated++;
    } catch (err) {
      const reason = err instanceof DomainError ? err.message : "Erro ao persistir a linha.";
      result.rejected.push({ line, reason, row });
    }
  }

  await auditLog(client, {
    userId: opts.actorUserId,
    module: "core",
    action: "IMPORTACAO_CONTATOS_EXECUTADA",
    payloadAfter: {
      contact_type: opts.contactType,
      created: result.created,
      updated: result.updated,
      skipped: result.skipped,
      rejected: result.rejected.length,
      labels: opts.labelIds.length,
      created_fields: createdFields.length,
    },
  });

  return result;
}

/** Retorna o primeiro campo obrigatório ausente para o tipo, ou `null`. */
function missingRequired(
  type: ImportContactType,
  std: Partial<Record<StandardField, string>>,
): StandardField | null {
  if (type === "pessoa") {
    if (!std.full_name) return "full_name";
    if (!std.email) return "email";
    if (!std.phone) return "phone";
    return null;
  }
  if (!std.legal_name) return "legal_name";
  if (!std.fiscal_document) return "fiscal_document";
  return null;
}

/** Resultado da criação/atualização de um contato para uma linha. */
type UpsertOutcome =
  | { action: "created" | "updated"; contactId: string }
  | { action: "skipped" };

/**
 * Cria o contato ou, se já existir (duplicata por chave natural), aplica a
 * estratégia escolhida. A detecção de duplicata reusa o erro de domínio de
 * `createContact`, que carrega o `existing_contact_id` nos detalhes.
 */
async function upsertContact(
  client: PoolClient,
  opts: ContactsImportOptions,
  std: Partial<Record<StandardField, string>>,
): Promise<UpsertOutcome> {
  const input =
    opts.contactType === "pessoa"
      ? {
          contact_type: "pessoa" as const,
          full_name: std.full_name!,
          email: std.email!,
          phone: std.phone!,
        }
      : {
          contact_type: "empresa" as const,
          legal_name: std.legal_name!,
          fiscal_document: std.fiscal_document!,
        };

  try {
    const created = await createContact(client, input, opts.actorUserId);
    return { action: "created", contactId: created.id };
  } catch (err) {
    const isDuplicate =
      err instanceof DomainError &&
      (err.code === ErrorCode.CONTACT_DUPLICATE_EMAIL ||
        err.code === ErrorCode.CONTACT_DUPLICATE_DOCUMENT);
    if (!isDuplicate) throw err;

    const existingId = (err as DomainError).details["existing_contact_id"] as string | undefined;
    if (opts.duplicateStrategy === "skip" || !existingId) {
      return { action: "skipped" };
    }

    // update: atualiza os campos mapeados do contato existente.
    const existing = await getContactData(client, existingId);
    if (!existing) return { action: "skipped" };

    // Monta o patch apenas com os campos presentes (exactOptionalPropertyTypes).
    const patch: {
      full_name?: string;
      email?: string;
      phone?: string;
      legal_name?: string;
      fiscal_document?: string;
    } = {};
    if (opts.contactType === "pessoa") {
      if (std.full_name !== undefined) patch.full_name = std.full_name;
      if (std.email !== undefined) patch.email = std.email;
      if (std.phone !== undefined) patch.phone = std.phone;
    } else {
      if (std.legal_name !== undefined) patch.legal_name = std.legal_name;
      if (std.fiscal_document !== undefined) patch.fiscal_document = std.fiscal_document;
    }

    await updateContact(client, existingId, patch, opts.actorUserId);
    return { action: "updated", contactId: existingId };
  }
}
