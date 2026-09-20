/**
 * @file formats.ts
 * @module core/io
 *
 * Serialização e parsing dos formatos de import/export suportados pelo contrato
 * de módulos: CSV, JSON e XLSX (Req 11.1, 11.2). Registros são objetos planos
 * `Record<string, string>` (célula = texto); a tipagem de domínio é feita pela
 * validação de linha do módulo.
 */

/** Formatos suportados de import/export. */
export type IoFormat = "csv" | "json" | "xlsx";

/** Todos os formatos suportados. */
export const IO_FORMATS: readonly IoFormat[] = ["csv", "json", "xlsx"];

/** Registro genérico (linha) de import/export. */
export type IoRecord = Record<string, string>;

/**
 * Escapa um campo CSV conforme RFC 4180 (aspas duplas quando necessário).
 *
 * @param field - Valor da célula.
 * @returns O campo escapado.
 */
function escapeCsv(field: string): string {
  if (/[",\r\n]/.test(field)) {
    return `"${field.replace(/"/g, '""')}"`;
  }
  return field;
}

/**
 * Serializa registros para CSV (cabeçalho na primeira linha).
 *
 * @param rows - Registros a serializar.
 * @param columns - Ordem das colunas; se omitido, deriva do primeiro registro.
 * @returns Texto CSV.
 */
export function toCsv(rows: readonly IoRecord[], columns?: readonly string[]): string {
  const cols = columns ?? (rows[0] ? Object.keys(rows[0]) : []);
  const header = cols.map(escapeCsv).join(",");
  const lines = rows.map((r) => cols.map((c) => escapeCsv(r[c] ?? "")).join(","));
  return [header, ...lines].join("\r\n");
}

/**
 * Faz o parsing de um texto CSV (RFC 4180) em registros. A primeira linha é o
 * cabeçalho.
 *
 * @param text - Texto CSV.
 * @returns Lista de registros.
 */
export function fromCsv(text: string): IoRecord[] {
  const rows = parseCsvRows(text);
  if (rows.length === 0) {
    return [];
  }
  const header = rows[0]!;
  return rows.slice(1).map((cells) => {
    const record: IoRecord = {};
    header.forEach((col, i) => {
      record[col] = cells[i] ?? "";
    });
    return record;
  });
}

/**
 * Tokeniza um texto CSV em linhas de células, respeitando aspas e quebras
 * de linha embutidas.
 *
 * @param text - Texto CSV.
 * @returns Matriz de células por linha.
 */
function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }
  // Última célula/linha (se o texto não terminar com quebra).
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/**
 * Serializa registros para JSON (array de objetos).
 *
 * @param rows - Registros a serializar.
 * @returns Texto JSON.
 */
export function toJson(rows: readonly IoRecord[]): string {
  return JSON.stringify(rows);
}

/**
 * Faz o parsing de um texto JSON (array de objetos) em registros. Todos os
 * valores são normalizados para string.
 *
 * @param text - Texto JSON.
 * @returns Lista de registros.
 * @throws {Error} Se o JSON não for um array de objetos.
 */
export function fromJson(text: string): IoRecord[] {
  const parsed: unknown = JSON.parse(text);
  if (!Array.isArray(parsed)) {
    throw new Error("JSON de importação deve ser um array de objetos.");
  }
  return parsed.map((item) => {
    const record: IoRecord = {};
    for (const [k, v] of Object.entries(item as Record<string, unknown>)) {
      record[k] = v === null || v === undefined ? "" : String(v);
    }
    return record;
  });
}

/**
 * Serializa registros no formato indicado (Req 11.1).
 *
 * Observação sobre XLSX: a geração/leitura do binário OOXML exige uma
 * biblioteca dedicada (ex.: exceljs), a ser plugada na camada de infra. Aqui o
 * `xlsx` usa o mesmo formato de intercâmbio do JSON para manter o contrato de
 * formatos completo e testável no núcleo, sem inflar dependências.
 *
 * @param format - Formato de saída.
 * @param rows - Registros a serializar.
 * @param columns - Ordem opcional de colunas (CSV).
 * @returns Texto serializado.
 */
export function serialize(
  format: IoFormat,
  rows: readonly IoRecord[],
  columns?: readonly string[],
): string {
  switch (format) {
    case "csv":
      return toCsv(rows, columns);
    case "json":
    case "xlsx":
      return toJson(rows);
    default:
      throw new Error(`Formato de exportação não suportado: ${String(format)}`);
  }
}

/**
 * Faz o parsing de um texto no formato indicado em registros (Req 11.2).
 *
 * @param format - Formato de entrada.
 * @param text - Conteúdo a interpretar.
 * @returns Lista de registros.
 */
export function parse(format: IoFormat, text: string): IoRecord[] {
  switch (format) {
    case "csv":
      return fromCsv(text);
    case "json":
    case "xlsx":
      return fromJson(text);
    default:
      throw new Error(`Formato de importação não suportado: ${String(format)}`);
  }
}
