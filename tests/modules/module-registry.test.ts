import { describe, it, expect, afterAll } from "vitest";
import fc from "fast-check";
import { withRollback, closeTestPool } from "../helpers/db.js";
import {
  registerModule,
  validateManifestShape,
  validateNamespaces,
  type ModuleManifest,
} from "../../src/core/modules/module-registry.js";
import { DomainError, ErrorCode } from "../../src/core/errors.js";

/**
 * @file module-registry.test.ts
 *
 * Testes do registro de módulos (Tarefa 11). Cobre P19 (campos obrigatórios),
 * P20 (module_id único), P21 (padrão do schema), P22 (tabelas de núcleo),
 * P23 (SemVer) e P24 (formato de namespace).
 */

const RUNS = { numRuns: 100 } as const;

afterAll(async () => {
  await closeTestPool();
});

/** Manifesto válido base para os testes. */
function baseManifest(overrides: Partial<ModuleManifest> = {}): ModuleManifest {
  return {
    module_id: `mod_x${Math.random().toString(36).slice(2, 8)}`,
    display_name: "Módulo Teste",
    schema: "mod_teste",
    version: "1.0.0",
    config_panel: true,
    has_export: true,
    has_import: true,
    emits_events: true,
    requires_core_tables: ["core.users", "core.contacts"],
    ...overrides,
  };
}

describe("Registro de módulos", () => {
  // Feature: central-contacts-and-module-contract, Property 19: Campos
  // obrigatórios do manifesto — registro aceito sse todos presentes; faltando,
  // rejeita identificando o campo.
  it("Property 19: rejeita manifesto com campo obrigatório ausente", async () => {
    const fields = [
      "module_id",
      "display_name",
      "schema",
      "version",
      "config_panel",
      "has_export",
      "has_import",
      "emits_events",
      "requires_core_tables",
    ] as const;
    fc.assert(
      fc.property(fc.constantFrom(...fields), (missing) => {
        const m = baseManifest() as Record<string, unknown>;
        delete m[missing];
        const res = validateManifestShape(m as Partial<ModuleManifest>);
        expect(res.ok).toBe(false);
        expect(res.error?.code).toBe(ErrorCode.MANIFEST_MISSING_FIELD);
        expect(res.error?.details.field).toBe(missing);
      }),
      RUNS,
    );
  });

  // Property 21: Padrão do schema do módulo.
  it("Property 21: schema é aceito sse casa mod_[a-z0-9_]+", async () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 20 }), (raw) => {
        const res = validateManifestShape(baseManifest({ schema: raw }));
        const valid = /^mod_[a-z0-9_]+$/.test(raw);
        if (valid) {
          expect(res.ok).toBe(true);
        } else if (raw !== "") {
          expect(res.ok).toBe(false);
        }
      }),
      RUNS,
    );
  });

  // Property 23: Versão em SemVer.
  it("Property 23: versão é aceita sse casa SemVer", async () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.tuple(fc.nat(), fc.nat(), fc.nat()).map(([a, b, c]) => `${a}.${b}.${c}`),
          fc.string({ maxLength: 10 }),
        ),
        (version) => {
          const res = validateManifestShape(baseManifest({ version }));
          const valid = /^\d+\.\d+\.\d+$/.test(version);
          if (valid) {
            expect(res.ok).toBe(true);
          } else if (version !== "") {
            expect(res.ok).toBe(false);
          }
        },
      ),
      RUNS,
    );
  });

  // Property 24: Formato de RBAC_Namespace.
  it("Property 24: namespace é aceito sse casa [modulo]:[recurso]:[acao]", async () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc
            .tuple(
              fc.stringMatching(/^[a-z0-9_]+$/),
              fc.stringMatching(/^[a-z0-9_]+$/),
              fc.stringMatching(/^[a-z0-9_]+$/),
            )
            .map(([a, b, c]) => `${a}:${b}:${c}`),
          fc.string({ maxLength: 15 }),
        ),
        (ns) => {
          const res = validateNamespaces([ns]);
          const valid = /^[a-z0-9_]+:[a-z0-9_]+:[a-z0-9_]+$/.test(ns);
          expect(res.ok).toBe(valid);
          if (!valid) {
            expect(res.error?.code).toBe(ErrorCode.RBAC_INVALID_NAMESPACE);
          }
        },
      ),
      RUNS,
    );
  });
});

describe("Registro de módulos (com banco)", () => {
  // Property 20: Unicidade de module_id no registro.
  it("Property 20: registrar module_id já existente é rejeitado", async () => {
    await withRollback(async (client) => {
      const m = baseManifest();
      await registerModule(client, m, ["crm:leads:visualizar"]);
      try {
        await registerModule(client, m, ["crm:leads:visualizar"]);
        expect.unreachable("deveria rejeitar module_id duplicado");
      } catch (err) {
        expect(err).toBeInstanceOf(DomainError);
        expect((err as DomainError).code).toBe(ErrorCode.MODULE_ALREADY_REGISTERED);
      }
    });
  });

  // Property 22: Verificação de tabelas de núcleo requeridas.
  it("Property 22: registro conclui sse todas as tabelas requeridas existem", async () => {
    await withRollback(async (client) => {
      // Todas existem: conclui.
      await registerModule(client, baseManifest({ requires_core_tables: ["core.users", "core.contacts"] }));

      // Tabela inexistente: rejeita nomeando a ausente.
      try {
        await registerModule(
          client,
          baseManifest({ requires_core_tables: ["core.inexistente"] }),
        );
        expect.unreachable("deveria rejeitar tabela de núcleo ausente");
      } catch (err) {
        expect(err).toBeInstanceOf(DomainError);
        const de = err as DomainError;
        expect(de.code).toBe(ErrorCode.MANIFEST_MISSING_CORE_TABLE);
        expect(de.details.missing_table).toBe("core.inexistente");
      }
    });
  });

  it("exemplo (Req 8.7): registro bem-sucedido grava auditoria MODULO_REGISTRADO", async () => {
    await withRollback(async (client) => {
      const m = baseManifest();
      await registerModule(client, m);
      const { rows } = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM core.system_logs
         WHERE action = 'MODULO_REGISTRADO' AND payload_after->>'module_id' = $1`,
        [m.module_id],
      );
      expect(rows[0]?.count).toBe("1");
    });
  });
});
