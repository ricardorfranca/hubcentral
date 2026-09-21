import { describe, it, expect, afterAll } from "vitest";
import fc from "fast-check";
import type { PoolClient } from "pg";
import { withRollback, closeTestPool } from "../helpers/db.js";
import { grantNamespace } from "../../src/core/iam/rbac.js";
import { exportData, importData, type RowValidation } from "../../src/core/io/import-export-gateway.js";
import {
  serialize,
  parse,
  serializeXlsx,
  parseXlsx,
  type IoFormat,
  type IoRecord,
} from "../../src/core/io/formats.js";
import { DomainError, ErrorCode } from "../../src/core/errors.js";

/**
 * @file import-export.test.ts
 *
 * Testes do gateway de import/export (Tarefa 13). Cobre P26 (validação antes
 * de persistir) e reusa P25 (permissão) e round-trip de formatos.
 */

const RUNS = { numRuns: 60 } as const;

afterAll(async () => {
  await closeTestPool();
});

async function newUser(client: PoolClient): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO core.users (email, full_name)
     VALUES ($1, 'IO User') RETURNING id`,
    [`io-${Math.random().toString(36).slice(2)}@example.com`],
  );
  return rows[0]!.id;
}

const recordArb: fc.Arbitrary<IoRecord> = fc.dictionary(
  fc.stringMatching(/^[a-z_]{1,8}$/),
  fc.string({ maxLength: 20 }),
  { minKeys: 1, maxKeys: 4 },
);

// Formatos textuais: CSV e JSON usam serialize/parse síncronos.
const textFormatArb = fc.constantFrom<IoFormat>("csv", "json");

/** Uniformiza as colunas entre linhas (CSV é posicional por cabeçalho). */
function normalizeRows(rowsRaw: readonly IoRecord[]): { rows: IoRecord[]; cols: string[] } {
  const cols = Array.from(new Set(rowsRaw.flatMap((r) => Object.keys(r))));
  const rows = rowsRaw.map((r) => {
    const norm: IoRecord = {};
    for (const c of cols) norm[c] = r[c] ?? "";
    return norm;
  });
  return { rows, cols };
}

describe("Formatos de import/export", () => {
  it("round-trip serialize→parse preserva os registros (CSV/JSON, colunas uniformes)", async () => {
    await fc.assert(
      fc.property(
        textFormatArb,
        fc.array(recordArb, { minLength: 1, maxLength: 8 }),
        (format, rowsRaw) => {
          const { rows, cols } = normalizeRows(rowsRaw);
          if (cols.length === 0) return;

          const text = serialize(format, rows, cols);
          const back = parse(format, text);
          expect(back).toEqual(rows);
        },
      ),
      RUNS,
    );
  });

  it("round-trip XLSX (binário) preserva os registros (colunas uniformes)", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(recordArb, { minLength: 1, maxLength: 8 }),
        async (rowsRaw) => {
          const { rows, cols } = normalizeRows(rowsRaw);
          if (cols.length === 0) return;
          // parseXlsx descarta, por projeto, linhas totalmente vazias (ruído
          // comum no fim de planilhas). Comparamos contra as linhas com ao
          // menos uma célula não vazia — que é o que a importação persiste.
          const expected = rows.filter((r) => Object.values(r).some((v) => v !== ""));

          const buffer = await serializeXlsx(rows, cols);
          const back = await parseXlsx(buffer);
          expect(back).toEqual(expected);
        },
      ),
      { numRuns: 20 },
    );
  });

  it("serialize/parse rejeitam xlsx (formato binário) com mensagem orientando o uso correto", () => {
    expect(() => serialize("xlsx", [{ a: "1" }], ["a"])).toThrow(/serializeXlsx/);
    expect(() => parse("xlsx", "")).toThrow(/parseXlsx/);
  });

  it("CSV: round-trip de casos de borda (campo vazio, vírgula, aspas, quebra de linha)", () => {
    const cases: IoRecord[][] = [
      [{ a: "" }], // única coluna, valor vazio (regressão da flaky test)
      [{ a: "", b: "" }], // múltiplas colunas vazias
      [{ nome: "Silva, João", obs: 'ele disse "oi"' }], // vírgula e aspas
      [{ texto: "linha1\nlinha2" }], // quebra de linha embutida
      [{ a: "x" }, { a: "" }, { a: "y" }], // linha vazia no meio
    ];
    for (const rows of cases) {
      const cols = Object.keys(rows[0]!);
      expect(parse("csv", serialize("csv", rows, cols))).toEqual(rows);
    }
  });
});

describe("Import/Export Gateway", () => {
  // Feature: central-contacts-and-module-contract, Property 26: Importação
  // valida antes de persistir — apenas linhas válidas são persistidas; cada
  // rejeitada retorna com o motivo.
  it("Property 26: só linhas válidas persistem; rejeitadas voltam com motivo", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.record({ v: fc.integer({ min: 0, max: 20 }) }), { minLength: 1, maxLength: 12 }),
        async (items) => {
          await withRollback(async (client) => {
            const userId = await newUser(client);
            await grantNamespace(client, userId, "mod_demo:itens:importar");

            // Regra: par = válido, ímpar = rejeitado.
            const rows: IoRecord[] = items.map((it) => ({ v: String(it.v) }));
            const content = JSON.stringify(rows);
            const persisted: string[] = [];

            const validateRow = (row: IoRecord): RowValidation => {
              const n = Number(row.v);
              return n % 2 === 0
                ? { ok: true, value: row }
                : { ok: false, reason: "valor ímpar não é permitido" };
            };

            const result = await importData(client, {
              module: "mod_demo",
              resource: "itens",
              format: "json",
              userId,
              content,
              validateRow,
              persistRow: async (_c, row) => {
                persisted.push(row.v!);
              },
            });

            const expectedValid = rows.filter((r) => Number(r.v) % 2 === 0);
            const expectedRejected = rows.filter((r) => Number(r.v) % 2 !== 0);

            expect(result.imported).toBe(expectedValid.length);
            expect(result.rejected).toHaveLength(expectedRejected.length);
            expect(persisted).toEqual(expectedValid.map((r) => r.v));
            for (const rej of result.rejected) {
              expect(rej.reason).toBe("valor ímpar não é permitido");
            }
          });
        },
      ),
      RUNS,
    );
  });

  it("reusa P25: exportar/importar sem permissão é negado", async () => {
    await withRollback(async (client) => {
      const userId = await newUser(client);
      // Sem grant.
      try {
        await exportData(client, {
          module: "mod_demo",
          resource: "itens",
          format: "csv",
          userId,
          rows: [{ v: "1" }],
        });
        expect.unreachable("deveria negar exportação sem permissão");
      } catch (err) {
        expect((err as DomainError).code).toBe(ErrorCode.RBAC_ACCESS_DENIED);
      }

      try {
        await importData(client, {
          module: "mod_demo",
          resource: "itens",
          format: "json",
          userId,
          content: "[]",
          validateRow: (r) => ({ ok: true, value: r }),
          persistRow: async () => {},
        });
        expect.unreachable("deveria negar importação sem permissão");
      } catch (err) {
        expect((err as DomainError).code).toBe(ErrorCode.RBAC_ACCESS_DENIED);
      }
    });
  });
});
