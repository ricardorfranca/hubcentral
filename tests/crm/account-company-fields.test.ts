import { describe, it, expect, afterAll } from "vitest";
import { withRollback, closeTestPool } from "../helpers/db.js";
import { createAccount } from "../../src/modules/crm/account-service.js";
import { getContactData } from "../../src/core/contacts/contact-service.js";

/**
 * @file account-company-fields.test.ts
 *
 * O cadastro rápido de empresa pelo CRM (autofill de CNPJ) deve gravar os dados
 * oficiais obtidos em `core.contacts` em vez de descartá-los — mas sem nunca
 * sobrescrever o cadastro de uma empresa que já existe na Base Central.
 */

afterAll(async () => {
  await closeTestPool();
});

/** CNPJ único de 14 dígitos por caso. */
function uniqueCnpj(): string {
  return String(40000000000000 + Math.floor(Math.random() * 9999999));
}

describe("Conta do CRM e dados cadastrais da empresa", () => {
  it("grava os dados oficiais do autofill ao criar a empresa", async () => {
    await withRollback(async (client) => {
      const cnpj = uniqueCnpj();
      const account = await createAccount(client, {
        legalName: "Acme Telecom LTDA",
        cnpj,
        company: { city: "São Paulo", state: "sp", phone_primary: "+5511999990000" },
      });

      const company = await getContactData(client, account.company_contact_id);
      expect(company?.legal_name).toBe("Acme Telecom LTDA");
      expect(company?.city).toBe("São Paulo");
      // A UF é normalizada pelo núcleo, mesmo vindo minúscula do autofill.
      expect(company?.state).toBe("SP");
      expect(company?.phone_primary).toBe("+5511999990000");
      // Campos não informados continuam no padrão.
      expect(company?.contract_active).toBe(false);
      expect(company?.zip_code).toBeNull();
    });
  });

  it("não sobrescreve o cadastro de uma empresa já existente", async () => {
    await withRollback(async (client) => {
      const cnpj = uniqueCnpj();

      const first = await createAccount(client, {
        legalName: "Original LTDA",
        cnpj,
        company: { city: "Campinas", state: "SP" },
      });

      // Segunda chamada com o mesmo CNPJ e dados diferentes: find-or-create
      // reaproveita a empresa e preserva o que já estava gravado.
      const second = await createAccount(client, {
        legalName: "Outro Nome LTDA",
        cnpj,
        company: { city: "Rio de Janeiro", state: "RJ" },
      });

      expect(second.company_contact_id).toBe(first.company_contact_id);
      expect(second.id).toBe(first.id);

      const company = await getContactData(client, first.company_contact_id);
      expect(company?.legal_name).toBe("Original LTDA");
      expect(company?.city).toBe("Campinas");
      expect(company?.state).toBe("SP");
    });
  });

  it("criar conta sem dados de autofill continua funcionando", async () => {
    await withRollback(async (client) => {
      const account = await createAccount(client, { legalName: "Simples LTDA", cnpj: uniqueCnpj() });
      const company = await getContactData(client, account.company_contact_id);
      expect(company?.legal_name).toBe("Simples LTDA");
      expect(company?.city).toBeNull();
    });
  });
});
