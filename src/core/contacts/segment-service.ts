/**
 * @file segment-service.ts
 * @module core/contacts
 *
 * SegmentService — define, persiste e avalia segmentos de contatos (Req 6).
 * A avaliação compila os critérios para SQL parametrizado que projeta apenas
 * `contact_id`, cumprindo o princípio de retornar somente referências.
 */

import type { PoolClient } from "pg";
import { DomainError, ErrorCode } from "../errors.js";

/** Operadores suportados em predicados de campo personalizado. */
export type CustomFieldOp = "eq" | "contains" | "gt" | "lt";

/** Predicado sobre um campo personalizado. */
export interface CustomFieldPredicate {
  fieldId: string;
  op: CustomFieldOp;
  value: unknown;
}

/**
 * Critérios de um segmento — conjunção (AND) de predicados sobre categorias,
 * vínculo a empresa e campos personalizados (design: SegmentCriteria).
 */
export interface SegmentCriteria {
  /** Contato pertence a TODAS as categorias listadas. */
  categories?: string[];
  /** Pessoa vinculada à empresa dada. */
  linkedToCompany?: string;
  /** Predicados sobre campos personalizados (todos devem casar). */
  customFields?: CustomFieldPredicate[];
}

/** Segmento persistido em `core.segments`. */
export interface Segment {
  id: string;
  name: string;
  criteria: SegmentCriteria;
  created_by: string;
  created_at: Date;
}

/**
 * Indica se um conjunto de critérios está vazio (nenhum predicado efetivo).
 *
 * @param criteria - Critérios a inspecionar.
 * @returns `true` se não há nenhum critério efetivo.
 */
function isEmptyCriteria(criteria: SegmentCriteria): boolean {
  const hasCategories = (criteria.categories?.length ?? 0) > 0;
  const hasCompany = typeof criteria.linkedToCompany === "string" && criteria.linkedToCompany !== "";
  const hasFields = (criteria.customFields?.length ?? 0) > 0;
  return !hasCategories && !hasCompany && !hasFields;
}

/**
 * Persiste um segmento para reutilização (Req 6.4).
 *
 * @param client - Cliente PostgreSQL.
 * @param name - Nome do segmento.
 * @param criteria - Critérios do segmento.
 * @param userId - `user_id` do autor.
 * @returns O segmento criado.
 * @throws {DomainError} `SEGMENT_EMPTY_CRITERIA` se os critérios forem vazios (Req 6.5).
 */
export async function createSegment(
  client: PoolClient,
  name: string,
  criteria: SegmentCriteria,
  userId: string,
): Promise<Segment> {
  if (isEmptyCriteria(criteria)) {
    throw new DomainError(
      ErrorCode.SEGMENT_EMPTY_CRITERIA,
      "Um segmento deve definir ao menos um critério.",
    );
  }
  const { rows } = await client.query<Segment>(
    `INSERT INTO core.segments (name, criteria, created_by)
     VALUES ($1, $2::jsonb, $3)
     RETURNING id, name, criteria, created_by, created_at`,
    [name, JSON.stringify(criteria), userId],
  );
  return rows[0] as Segment;
}

/**
 * Compila `SegmentCriteria` para uma cláusula WHERE parametrizada sobre
 * `core.contacts c`. Retorna a cláusula e os parâmetros na ordem.
 *
 * @param criteria - Critérios a compilar.
 * @returns Objeto com `where` (SQL) e `params` (valores).
 */
function compileCriteria(criteria: SegmentCriteria): { where: string; params: unknown[] } {
  const clauses: string[] = ["c.merged_into IS NULL"];
  const params: unknown[] = [];

  // Categorias: contato pertence a TODAS as categorias (conta distinta = tamanho).
  if (criteria.categories && criteria.categories.length > 0) {
    params.push(criteria.categories);
    const catParam = `$${params.length}`;
    params.push(criteria.categories.length);
    const countParam = `$${params.length}`;
    clauses.push(
      `(SELECT count(DISTINCT a.category_id) FROM core.contact_category_assignments a
        WHERE a.contact_id = c.id AND a.category_id = ANY(${catParam}::uuid[])) = ${countParam}`,
    );
  }

  // Vínculo a uma empresa específica (contato é a pessoa vinculada).
  if (typeof criteria.linkedToCompany === "string" && criteria.linkedToCompany !== "") {
    params.push(criteria.linkedToCompany);
    const companyParam = `$${params.length}`;
    clauses.push(
      `EXISTS (SELECT 1 FROM core.contact_company_links l
               WHERE l.person_id = c.id AND l.company_id = ${companyParam}::uuid)`,
    );
  }

  // Predicados de campo personalizado (todos devem casar).
  for (const pred of criteria.customFields ?? []) {
    params.push(pred.fieldId);
    const fieldParam = `$${params.length}`;
    params.push(JSON.stringify(pred.value));
    const valueParam = `$${params.length}`;
    const comparison = compileFieldComparison(pred.op, valueParam);
    clauses.push(
      `EXISTS (SELECT 1 FROM core.contact_custom_field_values v
               WHERE v.contact_id = c.id AND v.field_id = ${fieldParam}::uuid AND ${comparison})`,
    );
  }

  return { where: clauses.join(" AND "), params };
}

/**
 * Gera a expressão de comparação de valor JSONB para um operador.
 *
 * @param op - Operador do predicado.
 * @param valueParam - Placeholder do valor (ex.: `$3`).
 * @returns A expressão SQL de comparação.
 */
function compileFieldComparison(op: CustomFieldOp, valueParam: string): string {
  switch (op) {
    case "eq":
      return `v.value = ${valueParam}::jsonb`;
    case "contains":
      // Comparação textual de "contém" para valores string.
      return `(v.value #>> '{}') LIKE '%' || (${valueParam}::jsonb #>> '{}') || '%'`;
    case "gt":
      return `(v.value)::numeric > (${valueParam}::jsonb)::numeric`;
    case "lt":
      return `(v.value)::numeric < (${valueParam}::jsonb)::numeric`;
    default:
      // Operador desconhecido nunca casa.
      return "false";
  }
}

/**
 * Avalia um segmento (ou critérios avulsos) e retorna apenas os `contact_id`
 * que satisfazem TODOS os critérios (Req 6.1, 6.2). Retorna somente
 * referências, nunca dados de contato (Req 6.3).
 *
 * @param client - Cliente PostgreSQL.
 * @param criteria - Critérios a avaliar.
 * @returns Lista de `contact_id` que satisfazem os critérios.
 * @throws {DomainError} `SEGMENT_EMPTY_CRITERIA` se os critérios forem vazios (Req 6.5).
 */
export async function evaluateSegment(
  client: PoolClient,
  criteria: SegmentCriteria,
): Promise<string[]> {
  if (isEmptyCriteria(criteria)) {
    throw new DomainError(
      ErrorCode.SEGMENT_EMPTY_CRITERIA,
      "Não é possível avaliar um segmento sem critérios.",
    );
  }
  const { where, params } = compileCriteria(criteria);
  const { rows } = await client.query<{ id: string }>(
    `SELECT c.id FROM core.contacts c WHERE ${where}`,
    params,
  );
  return rows.map((r) => r.id);
}

/**
 * Resolve um segmento persistido para uma lista de referências de contato,
 * consumível por módulos (Req 6.3). Retorna apenas `{ contact_id }`.
 *
 * @param client - Cliente PostgreSQL.
 * @param segmentId - `id` do segmento persistido.
 * @returns Lista de referências `{ contact_id }`.
 * @throws {DomainError} `SEGMENT_EMPTY_CRITERIA` se o segmento não existe ou tem critérios vazios.
 */
export async function resolveForModule(
  client: PoolClient,
  segmentId: string,
): Promise<{ contact_id: string }[]> {
  const { rows } = await client.query<{ criteria: SegmentCriteria }>(
    `SELECT criteria FROM core.segments WHERE id = $1`,
    [segmentId],
  );
  const criteria = rows[0]?.criteria;
  if (!criteria) {
    throw new DomainError(ErrorCode.SEGMENT_EMPTY_CRITERIA, "Segmento não encontrado.", {
      segment_id: segmentId,
    });
  }
  const ids = await evaluateSegment(client, criteria);
  return ids.map((contact_id) => ({ contact_id }));
}
