/**
 * @file import-export.ts
 * @module http/routes
 *
 * Rotas do Assistente de Importação e Exportação de Dados. Operação de alto
 * risco (afeta a Base Central de Contatos em massa), restrita ao
 * SuperAdministrador (`role = 'superadmin'`). O fluxo do assistente é:
 *
 *  1. `POST /api/import-export/contacts/preview` (multipart): envia o arquivo,
 *     recebe cabeçalhos, amostra de linhas, campos padrão/personalizados e
 *     rótulos disponíveis para montar o mapeamento na UI.
 *  2. `POST /api/import-export/contacts/import` (JSON): envia as linhas
 *     parseadas + o mapeamento + rótulos + estratégia de duplicata; recebe o
 *     relatório de importados/atualizados/ignorados/rejeitados.
 *  3. `POST /api/import-export/contacts/export` (JSON): envia filtros e a
 *     seleção de colunas/campos; baixa o arquivo no formato escolhido.
 */

import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { withTransaction } from "../../core/db/pool.js";
import { isSuperadmin } from "../../core/iam/rbac.js";
import { DomainError, ErrorCode } from "../../core/errors.js";
import {
  parse,
  parseXlsx,
  serialize,
  serializeXlsx,
  IO_FORMATS,
  type IoFormat,
  type IoRecord,
} from "../../core/io/formats.js";
import {
  importContacts,
  type ColumnMapping,
  type DuplicateStrategy,
  type ImportContactType,
} from "../../core/io/contacts-import.js";
import {
  buildContactsExport,
  STANDARD_EXPORT_COLUMNS,
  type StandardExportColumn,
} from "../../core/io/contacts-export.js";
import { listCustomFieldDefs } from "../../core/contacts/custom-field-service.js";
import { listCategories } from "../../core/contacts/category-service.js";

/** Garante que o usuário é SuperAdministrador; lança caso contrário. */
async function requireSuperadmin(pool: Pool, userId: string | null): Promise<void> {
  if (!userId) {
    throw new DomainError(ErrorCode.AUTH_UNAUTHORIZED, "Requisição não autenticada.", {});
  }
  const ok = await withTransaction(pool, (c) => isSuperadmin(c, userId));
  if (!ok) {
    throw new DomainError(ErrorCode.RBAC_ACCESS_DENIED, "Acesso restrito ao SuperAdministrador.", {});
  }
}

/** Deriva o formato de import a partir do nome do arquivo. */
function formatFromFilename(filename: string): IoFormat | null {
  const ext = filename.split(".").pop()?.toLowerCase();
  if (ext === "csv") return "csv";
  if (ext === "json") return "json";
  if (ext === "xlsx") return "xlsx";
  return null;
}

/** Extrai os cabeçalhos (chaves) preservando a ordem de aparição nas linhas. */
function collectHeaders(rows: readonly IoRecord[]): string[] {
  const seen = new Set<string>();
  const headers: string[] = [];
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key);
        headers.push(key);
      }
    }
  }
  return headers;
}

/** Limite de linhas por importação (guarda contra payloads gigantes). */
const MAX_IMPORT_ROWS = 50_000;

/**
 * Registra as rotas do Assistente de Importação/Exportação.
 *
 * @param app - Instância Fastify.
 * @param pool - Pool de conexões.
 */
export function registerImportExportRoutes(app: FastifyInstance, pool: Pool): void {
  // 1) Preview de importação: recebe o arquivo (multipart) e devolve cabeçalhos,
  //    amostra, formato detectado, campos e rótulos disponíveis para o mapeamento.
  app.post("/api/import-export/contacts/preview", async (request, reply) => {
    await requireSuperadmin(pool, request.userId);

    const file = await request.file();
    if (!file) {
      return reply.status(400).send({ code: "IMPORT_INVALID", message: "Nenhum arquivo enviado.", details: {} });
    }
    const format = formatFromFilename(file.filename);
    if (!format) {
      return reply.status(400).send({
        code: "IMPORT_UNSUPPORTED_FORMAT",
        message: "Formato não suportado. Envie um arquivo .csv, .xlsx ou .json.",
        details: { filename: file.filename },
      });
    }

    const buffer = await file.toBuffer();
    let rows: IoRecord[];
    try {
      rows = format === "xlsx" ? await parseXlsx(buffer) : parse(format, buffer.toString("utf8"));
    } catch (err) {
      return reply.status(400).send({
        code: "IMPORT_PARSE_ERROR",
        message: err instanceof Error ? err.message : "Falha ao interpretar o arquivo.",
        details: {},
      });
    }

    if (rows.length > MAX_IMPORT_ROWS) {
      return reply.status(400).send({
        code: "IMPORT_TOO_LARGE",
        message: `O arquivo excede o limite de ${MAX_IMPORT_ROWS} linhas.`,
        details: { rows: rows.length, max: MAX_IMPORT_ROWS },
      });
    }

    const headers = collectHeaders(rows);
    const [customFields, labels] = await withTransaction(pool, async (c) => [
      await listCustomFieldDefs(c),
      await listCategories(c),
    ]);

    return reply.send({
      format,
      total_rows: rows.length,
      headers,
      sample: rows.slice(0, 20),
      // Devolve TODAS as linhas para a etapa de execução (evita reenviar o binário).
      rows,
      custom_fields: customFields,
      labels,
      standard_fields: ["full_name", "email", "phone", "legal_name", "fiscal_document"],
    });
  });

  // 2) Execução da importação (JSON): linhas + mapeamento + rótulos + estratégia.
  app.post<{
    Body: {
      contact_type: ImportContactType;
      rows: IoRecord[];
      mappings: ColumnMapping[];
      label_ids?: string[];
      duplicate_strategy?: DuplicateStrategy;
    };
  }>("/api/import-export/contacts/import", async (request, reply) => {
    await requireSuperadmin(pool, request.userId);

    const body = request.body;
    if (body.contact_type !== "pessoa" && body.contact_type !== "empresa") {
      return reply.status(400).send({ code: "IMPORT_INVALID", message: "Tipo de contato inválido.", details: {} });
    }
    if (!Array.isArray(body.rows) || body.rows.length === 0) {
      return reply.status(400).send({ code: "IMPORT_INVALID", message: "Nenhuma linha para importar.", details: {} });
    }
    if (body.rows.length > MAX_IMPORT_ROWS) {
      return reply.status(400).send({
        code: "IMPORT_TOO_LARGE",
        message: `A importação excede o limite de ${MAX_IMPORT_ROWS} linhas.`,
        details: { rows: body.rows.length, max: MAX_IMPORT_ROWS },
      });
    }
    if (!Array.isArray(body.mappings)) {
      return reply.status(400).send({ code: "IMPORT_INVALID", message: "Mapeamento ausente.", details: {} });
    }

    const result = await withTransaction(pool, (c) =>
      importContacts(c, {
        contactType: body.contact_type,
        rows: body.rows,
        mappings: body.mappings,
        labelIds: body.label_ids ?? [],
        duplicateStrategy: body.duplicate_strategy ?? "skip",
        actorUserId: request.userId,
      }),
    );

    return reply.send(result);
  });

  // 3) Exportação (JSON de opções -> download do arquivo no formato escolhido).
  app.post<{
    Body: {
      format?: IoFormat;
      filters?: { type?: "pessoa" | "empresa"; label_id?: string; search?: string };
      standard_columns?: StandardExportColumn[];
      custom_field_ids?: string[];
    };
  }>("/api/import-export/contacts/export", async (request, reply) => {
    await requireSuperadmin(pool, request.userId);

    const format: IoFormat = request.body.format ?? "csv";
    if (!IO_FORMATS.includes(format)) {
      return reply.status(400).send({ code: "EXPORT_INVALID_FORMAT", message: "Formato inválido.", details: {} });
    }

    // Monta os filtros apenas com as chaves presentes (exactOptionalPropertyTypes).
    const filters: { type?: "pessoa" | "empresa"; labelId?: string; search?: string } = {};
    if (request.body.filters?.type) filters.type = request.body.filters.type;
    if (request.body.filters?.label_id) filters.labelId = request.body.filters.label_id;
    if (request.body.filters?.search) filters.search = request.body.filters.search;

    const exportOpts: {
      filters: typeof filters;
      standardColumns?: StandardExportColumn[];
      customFieldIds?: string[];
    } = { filters };
    if (request.body.standard_columns) exportOpts.standardColumns = request.body.standard_columns;
    if (request.body.custom_field_ids) exportOpts.customFieldIds = request.body.custom_field_ids;

    const { rows, columns } = await withTransaction(pool, (c) => buildContactsExport(c, exportOpts));

    const stamp = new Date().toISOString().slice(0, 10);
    const base = `hubcentral-contatos-${stamp}`;

    if (format === "xlsx") {
      const buffer = await serializeXlsx(rows, columns);
      void reply.header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      void reply.header("Content-Disposition", `attachment; filename="${base}.xlsx"`);
      return reply.send(buffer);
    }

    const content = serialize(format, rows, columns);
    const contentType = format === "json" ? "application/json" : "text/csv; charset=utf-8";
    void reply.header("Content-Type", contentType);
    void reply.header("Content-Disposition", `attachment; filename="${base}.${format}"`);
    return reply.send(content);
  });

  // Metadados de exportação: colunas padrão e campos personalizados/rótulos
  // disponíveis, para o assistente montar a tela sem adivinhar.
  app.get("/api/import-export/contacts/export-metadata", async (request, reply) => {
    await requireSuperadmin(pool, request.userId);
    const [customFields, labels] = await withTransaction(pool, async (c) => [
      await listCustomFieldDefs(c),
      await listCategories(c),
    ]);
    return reply.send({
      standard_columns: STANDARD_EXPORT_COLUMNS,
      custom_fields: customFields,
      labels,
      formats: IO_FORMATS,
    });
  });
}
