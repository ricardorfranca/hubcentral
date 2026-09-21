import { describe, it, expect, afterAll } from "vitest";
import fc from "fast-check";
import type { PoolClient } from "pg";
import { withRollback, closeTestPool } from "../helpers/db.js";
import {
  createContact, getContactData, updateContact, listContacts,
} from "../../src/core/contacts/contact-service.js";
import { DomainError, ErrorCode } from "../../src/core/errors.js";

/**
 * @file company-registration.test.ts
 *
 * Dados cadastrais da empresa (status de contrato, endereço com CEP, inscrição
 * estadual, site, dois telefones com marcação de WhatsApp e gerente de contas).
 * Cobre round-trip de gravação, normalização (CEP/UF/site), validações e os
 * filtros de listagem.
 */

const RUNS = { numRuns: 30 } as const;

afterAll(async () => {
  await closeTestPool();
});

/** Documento fiscal único por caso, para não colidir com o índice de dedup. */
function uniqueDoc(): string {
  return `${Date.now()}${Math.floor(Math.random() * 1e6)}`.slice(0, 20);
}

/** Cria um usuário do sistema e retorna seu id (candidato a gerente de contas). */
async function newUser(client: PoolClient, name = "Gerente"): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO core.users (email, full_name) VALUES ($1, $2) RETURNING id`,
    [`mgr-${uniqueDoc()}@example.com`, name],
  );
  return rows[0]!.id;
}

/** Conjunto completo de dados cadastrais, para os testes de round-trip. */
function fullCompanyFields(managerId: string) {
  return {
    contract_active: true,
    state_tax_id: "110.042.490/0273",
    website: "https://acme.com.br",
    zip_code: "01310930",
    street_address: "Avenida Paulista",
    address_number: "1578",
    address_complement: "Sala 12",
    neighborhood: "Bela Vista",
    city: "São Paulo",
    state: "SP",
    phone_primary: "+5511999990000",
    phone_primary_is_whatsapp: true,
    phone_secondary: "+551133334444",
    phone_secondary_is_whatsapp: false,
    account_manager_user_id: managerId,
  };
}

describe("Dados cadastrais da empresa", () => {
  it("grava e devolve todos os campos cadastrais informados na criação", async () => {
    await withRollback(async (client) => {
      const managerId = await newUser(client);
      const fields = fullCompanyFields(managerId);

      const created = await createContact(client, {
        contact_type: "empresa",
        legal_name: "ACME Telecom LTDA",
        fiscal_document: uniqueDoc(),
        ...fields,
      });

      // Round-trip pela leitura, garantindo que persistiu (não só o RETURNING).
      const read = await getContactData(client, created.id);
      expect(read).not.toBeNull();
      for (const [key, value] of Object.entries(fields)) {
        expect(read![key as keyof typeof read]).toEqual(value);
      }
    });
  });

  it("empresa criada sem os campos novos tem contrato inativo e campos nulos", async () => {
    await withRollback(async (client) => {
      const created = await createContact(client, {
        contact_type: "empresa",
        legal_name: "Empresa Mínima",
        fiscal_document: uniqueDoc(),
      });
      expect(created.contract_active).toBe(false);
      expect(created.phone_primary_is_whatsapp).toBe(false);
      expect(created.phone_secondary_is_whatsapp).toBe(false);
      expect(created.zip_code).toBeNull();
      expect(created.city).toBeNull();
      expect(created.account_manager_user_id).toBeNull();
    });
  });

  it("normaliza CEP (só dígitos), UF (maiúscula) e site (esquema https)", async () => {
    await withRollback(async (client) => {
      const created = await createContact(client, {
        contact_type: "empresa",
        legal_name: "Normaliza LTDA",
        fiscal_document: uniqueDoc(),
        zip_code: "01310-930",
        state: "sp",
        website: "acme.com.br",
      });
      expect(created.zip_code).toBe("01310930");
      expect(created.state).toBe("SP");
      expect(created.website).toBe("https://acme.com.br");
    });
  });

  it("rejeita CEP fora de 8 dígitos e UF fora de 2 letras", async () => {
    await withRollback(async (client) => {
      await expect(
        createContact(client, {
          contact_type: "empresa",
          legal_name: "CEP Inválido",
          fiscal_document: uniqueDoc(),
          zip_code: "1234",
        }),
      ).rejects.toMatchObject({ code: ErrorCode.CONTACT_INVALID_ZIP_CODE });

      await expect(
        createContact(client, {
          contact_type: "empresa",
          legal_name: "UF Inválida",
          fiscal_document: uniqueDoc(),
          state: "São Paulo",
        }),
      ).rejects.toMatchObject({ code: ErrorCode.CONTACT_INVALID_STATE });
    });
  });

  it("rejeita gerente de contas inexistente", async () => {
    await withRollback(async (client) => {
      try {
        await createContact(client, {
          contact_type: "empresa",
          legal_name: "Sem Gerente",
          fiscal_document: uniqueDoc(),
          account_manager_user_id: "00000000-0000-0000-0000-000000000000",
        });
        expect.unreachable("deveria rejeitar gerente inexistente");
      } catch (err) {
        expect(err).toBeInstanceOf(DomainError);
        expect((err as DomainError).code).toBe(ErrorCode.CONTACT_MANAGER_NOT_FOUND);
      }
    });
  });

  it("PATCH atualiza os campos cadastrais e limpa com null", async () => {
    await withRollback(async (client) => {
      const managerId = await newUser(client);
      const created = await createContact(client, {
        contact_type: "empresa",
        legal_name: "Patch LTDA",
        fiscal_document: uniqueDoc(),
      });

      const updated = await updateContact(client, created.id, fullCompanyFields(managerId));
      expect(updated.contract_active).toBe(true);
      expect(updated.city).toBe("São Paulo");
      expect(updated.account_manager_user_id).toBe(managerId);
      expect(updated.phone_primary_is_whatsapp).toBe(true);

      const cleared = await updateContact(client, created.id, {
        contract_active: false,
        zip_code: null,
        account_manager_user_id: null,
        phone_secondary: null,
      });
      expect(cleared.contract_active).toBe(false);
      expect(cleared.zip_code).toBeNull();
      expect(cleared.account_manager_user_id).toBeNull();
      expect(cleared.phone_secondary).toBeNull();
      // Campos fora do patch permanecem intactos.
      expect(cleared.street_address).toBe("Avenida Paulista");
    });
  });

  it("Property: qualquer combinação de contrato/WhatsApp faz round-trip", async () => {
    await fc.assert(
      fc.asyncProperty(fc.boolean(), fc.boolean(), fc.boolean(), async (contract, wa1, wa2) => {
        await withRollback(async (client) => {
          const created = await createContact(client, {
            contact_type: "empresa",
            legal_name: "Booleans LTDA",
            fiscal_document: uniqueDoc(),
            contract_active: contract,
            phone_primary_is_whatsapp: wa1,
            phone_secondary_is_whatsapp: wa2,
          });
          expect(created.contract_active).toBe(contract);
          expect(created.phone_primary_is_whatsapp).toBe(wa1);
          expect(created.phone_secondary_is_whatsapp).toBe(wa2);
        });
      }),
      RUNS,
    );
  });

  it("listagem filtra por status de contrato e resolve o nome do gerente", async () => {
    await withRollback(async (client) => {
      const managerId = await newUser(client, "Ana Gerente");
      const ativa = await createContact(client, {
        contact_type: "empresa",
        legal_name: "Ativa LTDA",
        fiscal_document: uniqueDoc(),
        contract_active: true,
        account_manager_user_id: managerId,
        city: "Campinas",
      });
      const inativa = await createContact(client, {
        contact_type: "empresa",
        legal_name: "Inativa LTDA",
        fiscal_document: uniqueDoc(),
        contract_active: false,
      });

      const ativas = await listContacts(client, { type: "empresa", contractActive: true });
      const ativasIds = ativas.map((c) => c.id);
      expect(ativasIds).toContain(ativa.id);
      expect(ativasIds).not.toContain(inativa.id);
      expect(ativas.find((c) => c.id === ativa.id)?.account_manager_name).toBe("Ana Gerente");

      const inativas = await listContacts(client, { type: "empresa", contractActive: false });
      expect(inativas.map((c) => c.id)).toContain(inativa.id);
      expect(inativas.map((c) => c.id)).not.toContain(ativa.id);

      // Carteira do gerente.
      const daAna = await listContacts(client, { type: "empresa", accountManagerUserId: managerId });
      expect(daAna.map((c) => c.id)).toEqual([ativa.id]);

      // Busca textual passa a considerar a cidade.
      const porCidade = await listContacts(client, { type: "empresa", search: "Campinas" });
      expect(porCidade.map((c) => c.id)).toContain(ativa.id);
    });
  });

  it("o gerente de contas é desvinculado (SET NULL) se o usuário for removido", async () => {
    await withRollback(async (client) => {
      const managerId = await newUser(client);
      const created = await createContact(client, {
        contact_type: "empresa",
        legal_name: "SetNull LTDA",
        fiscal_document: uniqueDoc(),
        account_manager_user_id: managerId,
      });

      await client.query(`DELETE FROM core.users WHERE id = $1`, [managerId]);

      const read = await getContactData(client, created.id);
      expect(read?.account_manager_user_id).toBeNull();
      expect(read?.legal_name).toBe("SetNull LTDA");
    });
  });
});
