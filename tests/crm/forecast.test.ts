import { describe, it, expect, afterAll } from "vitest";
import fc from "fast-check";
import type { PoolClient } from "pg";
import { withRollback, closeTestPool } from "../helpers/db.js";
import { createAccount } from "../../src/modules/crm/account-service.js";
import { createOpportunity, moveStage, finalize } from "../../src/modules/crm/opportunity-service.js";
import { weightedForecast, newMrrArr, conversionByStage } from "../../src/modules/crm/forecast-service.js";

/**
 * @file forecast.test.ts
 *
 * Testes das métricas de Receita Previsível (Fase 2): forecast ponderado,
 * MRR/ARR novo, conversão por estágio.
 */

const RUNS = { numRuns: 25 } as const;

afterAll(async () => {
  await closeTestPool();
});

let seq = 0;
async function newAccount(client: PoolClient): Promise<string> {
  seq += 1;
  const acc = await createAccount(client, { legalName: `E ${seq}`, cnpj: String(20000000000000 + seq) });
  return acc.id;
}

describe("Forecast de Receita Previsível", () => {
  // Property: o forecast ponderado é a soma de (mrr*12 + one_time)*prob/100 das
  // oportunidades abertas, calculada em memória como oráculo.
  it("Property: forecast ponderado = soma ponderada das abertas", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            mrr: fc.integer({ min: 0, max: 5000 }),
            oneTime: fc.integer({ min: 0, max: 20000 }),
            stage: fc.constantFrom("novo", "qualificacao", "descoberta", "proposta", "negociacao"),
          }),
          { minLength: 1, maxLength: 6 },
        ),
        async (opps) => {
          await withRollback(async (client) => {
            const accountId = await newAccount(client);
            const probByStage: Record<string, number> = {
              novo: 10, qualificacao: 25, descoberta: 40, proposta: 60, negociacao: 80,
            };
            let expected = 0;
            for (const o of opps) {
              const created = await createOpportunity(client, { accountId, name: "op", mrr: o.mrr, oneTime: o.oneTime });
              if (o.stage !== "novo") await moveStage(client, created.id, o.stage);
              expected += (o.mrr * 12 + o.oneTime) * (probByStage[o.stage]! / 100);
            }
            const fc_ = await weightedForecast(client);
            expect(fc_.weighted).toBeCloseTo(expected, 2);
            expect(fc_.open_count).toBe(opps.length);
          });
        },
      ),
      RUNS,
    );
  });

  it("oportunidade ganha entra em MRR/ARR novo e sai do forecast aberto", async () => {
    await withRollback(async (client) => {
      const accountId = await newAccount(client);
      const opp = await createOpportunity(client, { accountId, name: "op", mrr: 1000, oneTime: 5000 });
      await finalize(client, opp.id, "won", { mrr: 1000, oneTime: 5000 });

      const now = new Date();
      const from = new Date(now.getFullYear(), now.getMonth(), 1);
      const to = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      const period = await newMrrArr(client, from, to);
      expect(period.new_mrr).toBe(1000);
      expect(period.new_arr).toBe(12000);

      const wf = await weightedForecast(client);
      expect(wf.open_count).toBe(0);
    });
  });

  it("conversão por estágio inclui todos os estágios na ordem", async () => {
    await withRollback(async (client) => {
      const rows = await conversionByStage(client);
      expect(rows.map((r) => r.stage_id).slice(0, 3)).toEqual(["novo", "qualificacao", "descoberta"]);
    });
  });
});
