import { describe, it, expect, afterAll } from "vitest";
import fc from "fast-check";
import type { PoolClient } from "pg";
import { withRollback, closeTestPool } from "../helpers/db.js";
import { createAccount, linkContact, getAccount } from "../../src/modules/crm/account-service.js";
import {
  createOpportunity, listOpportunities, moveStage, finalize,
} from "../../src/modules/crm/opportunity-service.js";
import { createContact } from "../../src/core/contacts/contact-service.js";
import { DomainError, ErrorCode } from "../../src/core/errors.js";

/**
 * @file opportunities.test.ts
 *
 * Testes do CRM 2.0 (Fase 1): contas B2B, oportunidades com MRR/valor único,
 * probabilidade herdada do estágio, ARR=MRR×12, repetibilidade por conta.
 */

const RUNS = { numRuns: 40 } as const;

afterAll(async () => {
  await closeTestPool();
});

let seq = 0;
/** Cria uma conta única e retorna seu id. */
async function newAccount(client: PoolClient): Promise<string> {
  seq += 1;
  const acc = await createAccount(client, {
    legalName: `Empresa ${seq}`,
    cnpj: String(10000000000000 + seq), // 14 dígitos
  });
  return acc.id;
}

/** Cria uma pessoa única e retorna seu `contact_id` (contato principal). */
async function newPerson(client: PoolClient): Promise<string> {
  seq += 1;
  const person = await createContact(client, {
    contact_type: "pessoa",
    full_name: `Responsável ${seq}`,
    email: `resp${seq}@exemplo.com`,
    phone: "11999990000",
  });
  return person.id;
}

describe("Contas B2B", () => {
  it("exige CNPJ válido (14 dígitos)", async () => {
    await withRollback(async (client) => {
      try {
        await createAccount(client, { legalName: "X", cnpj: "123" });
        expect.unreachable("deveria rejeitar CNPJ inválido");
      } catch (err) {
        expect((err as DomainError).code).toBe(ErrorCode.CRM_INVALID_CNPJ);
      }
    });
  });

  it("reusa a conta existente para a mesma empresa (idempotente por CNPJ)", async () => {
    await withRollback(async (client) => {
      const cnpj = "11222333000181";
      const a1 = await createAccount(client, { legalName: "Acme", cnpj });
      const a2 = await createAccount(client, { legalName: "Acme", cnpj: "11.222.333/0001-81" });
      expect(a2.id).toBe(a1.id);
    });
  });

  it("vincula contatos com papel e os retorna em getAccount", async () => {
    await withRollback(async (client) => {
      const accountId = await newAccount(client);
      const person = await createContact(client, {
        contact_type: "pessoa", full_name: "Decisor", email: `d${seq}@x.com`, phone: "11999990000",
      });
      await linkContact(client, accountId, person.id, "decisor");
      const view = await getAccount(client, accountId);
      expect(view?.contacts.some((c) => c.person_contact_id === person.id && c.role === "decisor")).toBe(true);
    });
  });
});

describe("Oportunidades", () => {
  it("Property: ARR = MRR × 12 e probabilidade herdada do estágio inicial (novo=10)", async () => {
    await fc.assert(
      fc.asyncProperty(fc.double({ min: 0, max: 100000, noNaN: true }), async (mrr) => {
        await withRollback(async (client) => {
          const accountId = await newAccount(client);
          const primaryContactId = await newPerson(client);
          await createOpportunity(client, { accountId, name: "Op", mrr, primaryContactId });
          const list = await listOpportunities(client, { accountId });
          expect(list).toHaveLength(1);
          expect(list[0]!.arr).toBeCloseTo(Number(list[0]!.mrr) * 12, 2);
          expect(list[0]!.probability).toBe(10);
        });
      }),
      RUNS,
    );
  });

  it("exige um contato principal (pessoa responsável na empresa)", async () => {
    await withRollback(async (client) => {
      const accountId = await newAccount(client);
      try {
        await createOpportunity(client, { accountId, name: "Sem contato", mrr: 100, primaryContactId: "" });
        expect.unreachable("deveria rejeitar oportunidade sem contato principal");
      } catch (err) {
        expect((err as DomainError).code).toBe(ErrorCode.CRM_OPP_NO_CONTACT);
      }
    });
  });

  it("vincula o contato principal à oportunidade e à conta", async () => {
    await withRollback(async (client) => {
      const accountId = await newAccount(client);
      const primaryContactId = await newPerson(client);
      const opp = await createOpportunity(client, { accountId, name: "Op", mrr: 100, primaryContactId });

      expect(opp.primary_contact_id).toBe(primaryContactId);

      // O contato passa a constar entre os contatos da conta.
      const view = await getAccount(client, accountId);
      expect(view?.contacts.some((c) => c.person_contact_id === primaryContactId)).toBe(true);

      // E a listagem resolve o nome do contato principal.
      const list = await listOpportunities(client, { accountId });
      expect(list[0]!.primary_contact_name).toContain("Responsável");
    });
  });

  it("permite múltiplas oportunidades para a mesma conta (repetível)", async () => {
    await withRollback(async (client) => {
      const accountId = await newAccount(client);
      const primaryContactId = await newPerson(client);
      await createOpportunity(client, { accountId, name: "Op1", mrr: 100, primaryContactId });
      await createOpportunity(client, { accountId, name: "Op2", mrr: 200, primaryContactId });
      const list = await listOpportunities(client, { accountId });
      expect(list).toHaveLength(2);
    });
  });

  it("mover para estágio atualiza a probabilidade (proposta=60)", async () => {
    await withRollback(async (client) => {
      const accountId = await newAccount(client);
      const primaryContactId = await newPerson(client);
      const opp = await createOpportunity(client, { accountId, name: "Op", mrr: 500, primaryContactId });
      const moved = await moveStage(client, opp.id, "proposta");
      expect(moved.stage_id).toBe("proposta");
      expect(moved.probability).toBe(60);
    });
  });

  it("finalizar como ganho exige valor; perdido exige motivo", async () => {
    await withRollback(async (client) => {
      const accountId = await newAccount(client);
      const primaryContactId = await newPerson(client);
      const opp1 = await createOpportunity(client, { accountId, name: "Op", mrr: 0, oneTime: 0, primaryContactId });
      try {
        await finalize(client, opp1.id, "won", {});
        expect.unreachable("ganho sem valor deveria falhar");
      } catch (err) {
        expect((err as DomainError).code).toBe(ErrorCode.CRM_OPP_FINALIZE_INVALID);
      }

      const won = await finalize(client, opp1.id, "won", { mrr: 1000 });
      expect(won.status).toBe("won");
      expect(won.probability).toBe(100);

      const opp2 = await createOpportunity(client, { accountId, name: "Op2", mrr: 100, primaryContactId });
      try {
        await finalize(client, opp2.id, "lost", {});
        expect.unreachable("perda sem motivo deveria falhar");
      } catch (err) {
        expect((err as DomainError).code).toBe(ErrorCode.CRM_OPP_FINALIZE_INVALID);
      }
      const lost = await finalize(client, opp2.id, "lost", { lossReason: "Preço" });
      expect(lost.status).toBe("lost");
    });
  });
});
