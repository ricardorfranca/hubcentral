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
  // Cada linha (cabeçalho e dados) é terminada por CRLF. Assim, uma linha de
  // dados composta apenas por campos vazios não se perde no round-trip: ela é
  // representada por um CRLF a mais, e não por "ausência de conteúdo".
  return [header, ...lines].map((line) => `${line}\r\n`).join("");
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
  // Indica que a linha corrente foi iniciada (há pelo menos uma célula em
  // andamento), mesmo que a célula esteja vazia. Distingue uma "linha final
  // com um único campo vazio" de "ausência de linha".
  let started = false;
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
      started = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
      started = true;
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      started = false;
    } else {
      cell += ch;
      started = true;
    }
  }
  // Emite a última linha se ela foi iniciada (inclui a linha final composta
  // apenas por um campo vazio).
  if (started || cell !== "" || row.length > 0) {
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
 * Serializa registros no formato TEXTUAL indicado (Req 11.1).
 *
 * Suporta apenas os formatos baseados em texto: `csv` e `json`. Para `xlsx`
 * (binário OOXML) use {@link serializeXlsx}, que produz um `Buffer` via
 * biblioteca dedicada. A camada HTTP escolhe entre esta função e a de XLSX
 * conforme o formato solicitado.
 *
 * @param format - Formato de saída (`csv` ou `json`).
 * @param rows - Registros a serializar.
 * @param columns - Ordem opcional de colunas (CSV).
 * @returns Texto serializado.
 * @throws {Error} Se `format` for `xlsx` (use {@link serializeXlsx}) ou desconhecido.
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
      return toJson(rows);
    case "xlsx":
      throw new Error("Formato xlsx é binário; use serializeXlsx para gerar o Buffer.");
    default:
      throw new Error(`Formato de exportação não suportado: ${String(format)}`);
  }
}

/**
 * Faz o parsing de um texto no formato TEXTUAL indicado em registros (Req 11.2).
 *
 * Suporta apenas `csv` e `json`. Para `xlsx` (binário) use {@link parseXlsx},
 * que lê a partir de um `Buffer`.
 *
 * @param format - Formato de entrada (`csv` ou `json`).
 * @param text - Conteúdo a interpretar.
 * @returns Lista de registros.
 * @throws {Error} Se `format` for `xlsx` (use {@link parseXlsx}) ou desconhecido.
 */
export function parse(format: IoFormat, text: string): IoRecord[] {
  switch (format) {
    case "csv":
      return fromCsv(text);
    case "json":
      return fromJson(text);
    case "xlsx":
      throw new Error("Formato xlsx é binário; use parseXlsx para ler o Buffer.");
    default:
      throw new Error(`Formato de importação não suportado: ${String(format)}`);
  }
}

/**
 * Serializa registros para uma planilha XLSX real (OOXML), via exceljs.
 *
 * A primeira linha é o cabeçalho (nomes das colunas); as demais são os dados.
 * Cada célula é escrita como texto para preservar o contrato `IoRecord`
 * (célula = string), evitando coerções silenciosas do Excel (ex.: perda de
 * zeros à esquerda em telefones/documentos).
 *
 * @param rows - Registros a serializar.
 * @param columns - Ordem das colunas; se omitido, deriva do primeiro registro.
 * @returns O conteúdo binário do arquivo `.xlsx`.
 */
export async function serializeXlsx(
  rows: readonly IoRecord[],
  columns?: readonly string[],
): Promise<Buffer> {
  // Import dinâmico: mantém o exceljs fora do caminho quente de CSV/JSON e
  // compatível com o carregamento ESM do pacote.
  const ExcelJS = (await import("exceljs")).default;
  const cols = columns ?? (rows[0] ? Object.keys(rows[0]) : []);
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Dados");

  sheet.addRow([...cols]);
  for (const record of rows) {
    sheet.addRow(cols.map((c) => record[c] ?? ""));
  }
  // Todas as células como texto, inclusive o cabeçalho.
  sheet.eachRow((row) => {
    row.eachCell((cell) => {
      cell.numFmt = "@";
    });
  });

  const out = await workbook.xlsx.writeBuffer();
  return Buffer.from(out);
}

/**
 * Faz o parsing de uma planilha XLSX (OOXML) em registros, via exceljs.
 *
 * Usa a PRIMEIRA planilha e a PRIMEIRA linha como cabeçalho. Cada valor de
 * célula é normalizado para string (datas em ISO `YYYY-MM-DD`; demais tipos
 * convertidos por `String`). Colunas sem cabeçalho recebem nome `coluna_N`.
 *
 * @param buffer - Conteúdo binário do arquivo `.xlsx`.
 * @returns Lista de registros.
 * @throws {Error} Se o arquivo não contiver planilhas.
 */
export async function parseXlsx(buffer: Buffer): Promise<IoRecord[]> {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  // exceljs aceita ArrayBuffer/Buffer; usamos o buffer subjacente.
  await workbook.xlsx.load(
    buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer,
  );
  const sheet = workbook.worksheets[0];
  if (!sheet) {
    throw new Error("Arquivo XLSX não contém planilhas.");
  }

  const cellToString = (value: unknown): string => {
    if (value === null || value === undefined) return "";
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    if (typeof value === "object") {
      // Célula de fórmula: { formula, result } ; hyperlink: { text } ; rich text.
      const obj = value as { result?: unknown; text?: unknown; richText?: { text: string }[] };
      if (Array.isArray(obj.richText)) return obj.richText.map((r) => r.text).join("");
      if (obj.text !== undefined) return String(obj.text);
      if (obj.result !== undefined) return String(obj.result);
      return "";
    }
    return String(value);
  };

  const headerRow = sheet.getRow(1);
  const header: string[] = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    const name = cellToString(cell.value).trim();
    header[colNumber - 1] = name || `coluna_${colNumber}`;
  });

  const records: IoRecord[] = [];
  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const record: IoRecord = {};
    let hasAny = false;
    for (let c = 0; c < header.length; c++) {
      const key = header[c] ?? `coluna_${c + 1}`;
      const value = cellToString(row.getCell(c + 1).value);
      if (value !== "") hasAny = true;
      record[key] = value;
    }
    // Ignora linhas totalmente vazias (comuns ao final de planilhas).
    if (hasAny) records.push(record);
  }
  return records;
}
