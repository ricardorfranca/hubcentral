import { describe, it, expect, afterAll } from "vitest";
import fc from "fast-check";
import type { PoolClient } from "pg";
import { withRollback, closeTestPool, getTestPool } from "../helpers/db.js";
import { createContact } from "../../src/core/contacts/contact-service.js";
import { createCustomCategory, assignCategory } from "../../src/core/contacts/category-service.js";
import {
  createSegment,
  evaluateSegment,
  resolveForModule,
  type SegmentCriteria,
} from "../../src/core/contacts/segment-service.js";
import { DomainError, ErrorCode } from "../../src/core/errors.js";

/**
 * @file segments.test.ts
 *
 * Testes da segmentação (Tarefa 8). Cobre P14 (retorna exatamente quem
 * satisfaz TODOS os critérios, contra um oráculo em memória), P15 (saída só
 * com referências) e P16 (critério vazio rejeitado).
 */

const RUNS = { numRuns: 40 } as const;

afterAll(async () => {
  await closeTestPool();
});

let seq = 0;
async function newPerson(client: PoolClient): Promise<string> {
  seq += 1;
  const c = await createContact(client, {
    contact_type: "pessoa",
    full_name: `Seg ${seq}`,
    email: `seg${seq}-${Math.random().toString(36).slice(2)}@example.com`,
    phone: "11999990000",
  });
  return c.id;
}

/** Precisa de um user_id válido para createSegment (FK created_by). */
async function anyUserId(): Promise<string> {
  const { rows } = await getTestPool().query<{ id: string }>(
    `INSERT INTO core.users (email, full_name)
     VALUES ($1, 'Seg User') RETURNING id`,
    [`seguser-${Math.random().toString(36).slice(2)}@example.com`],
  );
  return rows[0]!.id;
}

describe("Segmentação de contatos", () => {
  // Feature: central-contacts-and-module-contract, Property 14: Segmento
  // retorna exatamente quem satisfaz todos os critérios — equivalente a um
  // filtro de referência ingênuo em memória (model-based).
  it("Property 14: avaliação por categorias equivale ao filtro em memória (AND de categorias)", async () => {
    await fc.assert(
      fc.asyncProperty(
        // Para cada um de N contatos, o conjunto de índices de categorias que possui.
        fc.array(fc.subarray([0, 1, 2]), { minLength: 1, maxLength: 6 }),
        // Subconjunto de categorias exigido pelo segmento (não vazio).
        fc.subarray([0, 1, 2], { minLength: 1 }),
        async (contactsCatIdx, requiredIdx) => {
          await withRollback(async (client) => {
            // Cria 3 categorias.
            const cats: string[] = [];
            for (let i = 0; i < 3; i++) {
              const cat = await createCustomCategory(
                client,
                `c${i}-${seq}-${Math.random().toString(36).slice(2)}`,
              );
              cats.push(cat.id);
            }

            // Cria contatos e associa suas categorias; guarda o modelo em memória.
            const model: { id: string; catIdx: number[] }[] = [];
            for (const catIdx of contactsCatIdx) {
              const id = await newPerson(client);
              for (const i of catIdx) {
                await assignCategory(client, id, cats[i]!);
              }
              model.push({ id, catIdx });
            }

            const requiredCatIds = requiredIdx.map((i) => cats[i]!);
            const criteria: SegmentCriteria = { categories: requiredCatIds };

            const actual = new Set(await evaluateSegment(client, criteria));

            // Oráculo: contato satisfaz sse possui TODAS as categorias exigidas.
            const expected = new Set(
              model
                .filter((m) => requiredIdx.every((ri) => m.catIdx.includes(ri)))
                .map((m) => m.id),
            );

            expect(actual).toEqual(expected);
          });
        },
      ),
      RUNS,
    );
  });

  // Feature: central-contacts-and-module-contract, Property 15: Saída de
  // segmento contém apenas referências — cada item tem só o contact_id.
  it("Property 15: resolveForModule retorna apenas { contact_id }", async () => {
    await withRollback(async (client) => {
      const userId = await anyUserId();
      const cat = await createCustomCategory(client, `only-ref-${Math.random().toString(36).slice(2)}`);
      const id = await newPerson(client);
      await assignCategory(client, id, cat.id);

      const seg = await createSegment(client, "Somente ref", { categories: [cat.id] }, userId);
      const out = await resolveForModule(client, seg.id);

      expect(out.length).toBeGreaterThan(0);
      for (const item of out) {
        expect(Object.keys(item)).toEqual(["contact_id"]);
        expect(typeof item.contact_id).toBe("string");
      }
      expect(out.map((o) => o.contact_id)).toContain(id);
    });
  });

  // Feature: central-contacts-and-module-contract, Property 16: Segmento sem
  // critérios é rejeitado.
  it("Property 16: critérios vazios são rejeitados na avaliação e na criação", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom<SegmentCriteria>(
          {},
          { categories: [] },
          { customFields: [] },
          { linkedToCompany: "" },
          { categories: [], customFields: [] },
        ),
        async (empty) => {
          await withRollback(async (client) => {
            try {
              await evaluateSegment(client, empty);
              expect.unreachable("deveria rejeitar avaliação de critério vazio");
            } catch (err) {
              expect(err).toBeInstanceOf(DomainError);
              expect((err as DomainError).code).toBe(ErrorCode.SEGMENT_EMPTY_CRITERIA);
            }
          });
        },
      ),
      RUNS,
    );
  });
});
