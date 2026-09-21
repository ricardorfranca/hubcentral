import { describe, it, expect, afterAll } from "vitest";
import type { PoolClient } from "pg";
import { withRollback, closeTestPool } from "../helpers/db.js";
import { createContact } from "../../src/core/contacts/contact-service.js";
import {
  linkCompanyPerson, setLinkRole, listPeopleOfCompany, unlinkCompanyPerson,
  isCompanyPersonRole, COMPANY_PERSON_ROLES,
} from "../../src/core/contacts/link-service.js";
import { DomainError, ErrorCode } from "../../src/core/errors.js";

/**
 * @file company-people-roles.test.ts
 *
 * Papéis dos contatos vinculados a uma empresa: responsável principal, técnico,
 * portabilidade e contato extra. O responsável principal é único por empresa.
 */

afterAll(async () => {
  await closeTestPool();
});

/** Sufixo único para e-mails/documentos dos fixtures. */
function uniq(): string {
  return `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
}

/** Cria uma pessoa e retorna seu id. */
async function newPerson(client: PoolClient, name: string): Promise<string> {
  const c = await createContact(client, {
    contact_type: "pessoa",
    full_name: name,
    email: `p-${uniq()}@example.com`,
    phone: "+5511999990000",
  });
  return c.id;
}

/** Cria uma empresa e retorna seu id. */
async function newCompany(client: PoolClient): Promise<string> {
  const c = await createContact(client, {
    contact_type: "empresa",
    legal_name: `Empresa ${uniq()}`,
    fiscal_document: uniq().slice(0, 20),
  });
  return c.id;
}

describe("Papéis dos contatos vinculados à empresa", () => {
  it("o vocabulário canônico cobre os quatro papéis pedidos", () => {
    expect([...COMPANY_PERSON_ROLES]).toEqual(["principal", "tecnico", "portabilidade", "extra"]);
    for (const role of COMPANY_PERSON_ROLES) {
      expect(isCompanyPersonRole(role)).toBe(true);
    }
    expect(isCompanyPersonRole("financeiro")).toBe(false);
  });

  it("vincula uma pessoa por papel e lista com o principal primeiro", async () => {
    await withRollback(async (client) => {
      const companyId = await newCompany(client);
      const tecnico = await newPerson(client, "Zeca Técnico");
      const principal = await newPerson(client, "Ana Principal");
      const port = await newPerson(client, "Bia Portabilidade");
      const extra = await newPerson(client, "Caio Extra");

      await linkCompanyPerson(client, companyId, tecnico, "tecnico");
      await linkCompanyPerson(client, companyId, principal, "principal");
      await linkCompanyPerson(client, companyId, port, "portabilidade");
      await linkCompanyPerson(client, companyId, extra, "extra");

      const people = await listPeopleOfCompany(client, companyId);
      expect(people).toHaveLength(4);
      // O responsável principal vem primeiro, e os dados vêm resolvidos do núcleo.
      expect(people[0]?.role).toBe("principal");
      expect(people[0]?.full_name).toBe("Ana Principal");
      expect(people[0]?.email).toContain("@example.com");
      expect(new Set(people.map((p) => p.role))).toEqual(
        new Set(["principal", "tecnico", "portabilidade", "extra"]),
      );
    });
  });

  it("rejeita um segundo responsável principal na mesma empresa", async () => {
    await withRollback(async (client) => {
      const companyId = await newCompany(client);
      const primeiro = await newPerson(client, "Primeiro");
      const segundo = await newPerson(client, "Segundo");

      await linkCompanyPerson(client, companyId, primeiro, "principal");
      try {
        await linkCompanyPerson(client, companyId, segundo, "principal");
        expect.unreachable("deveria rejeitar o segundo responsável principal");
      } catch (err) {
        expect(err).toBeInstanceOf(DomainError);
        expect((err as DomainError).code).toBe(ErrorCode.LINK_PRINCIPAL_EXISTS);
      }

      // Outro papel é aceito para a mesma pessoa.
      const link = await linkCompanyPerson(client, companyId, segundo, "tecnico");
      expect(link.role).toBe("tecnico");
    });
  });

  it("empresas diferentes podem ter, cada uma, o seu responsável principal", async () => {
    await withRollback(async (client) => {
      const empresaA = await newCompany(client);
      const empresaB = await newCompany(client);
      const pessoa = await newPerson(client, "Compartilhada");

      await linkCompanyPerson(client, empresaA, pessoa, "principal");
      const link = await linkCompanyPerson(client, empresaB, pessoa, "principal");
      expect(link.role).toBe("principal");
    });
  });

  it("altera o papel de um vínculo existente, respeitando a unicidade do principal", async () => {
    await withRollback(async (client) => {
      const companyId = await newCompany(client);
      const ana = await newPerson(client, "Ana");
      const bia = await newPerson(client, "Bia");

      await linkCompanyPerson(client, companyId, ana, "principal");
      await linkCompanyPerson(client, companyId, bia, "extra");

      // Promover a Bia a principal com a Ana ainda principal deve falhar.
      await expect(setLinkRole(client, companyId, bia, "principal")).rejects.toMatchObject({
        code: ErrorCode.LINK_PRINCIPAL_EXISTS,
      });

      // Rebaixando a Ana, a promoção passa.
      await setLinkRole(client, companyId, ana, "tecnico");
      const promoted = await setLinkRole(client, companyId, bia, "principal");
      expect(promoted.role).toBe("principal");

      // Reatribuir o mesmo papel a quem já o tem é idempotente.
      const again = await setLinkRole(client, companyId, bia, "principal");
      expect(again.role).toBe("principal");

      // Remover o papel é permitido.
      const noRole = await setLinkRole(client, companyId, bia, null);
      expect(noRole.role).toBeNull();
    });
  });

  it("alterar o papel de um vínculo inexistente é erro de contato não encontrado", async () => {
    await withRollback(async (client) => {
      const companyId = await newCompany(client);
      const pessoa = await newPerson(client, "Solta");
      await expect(setLinkRole(client, companyId, pessoa, "tecnico")).rejects.toMatchObject({
        code: ErrorCode.CONTACT_NOT_FOUND,
      });
    });
  });

  it("desvincular libera o papel de responsável principal", async () => {
    await withRollback(async (client) => {
      const companyId = await newCompany(client);
      const ana = await newPerson(client, "Ana");
      const bia = await newPerson(client, "Bia");

      await linkCompanyPerson(client, companyId, ana, "principal");
      expect(await unlinkCompanyPerson(client, companyId, ana)).toBe(true);

      const link = await linkCompanyPerson(client, companyId, bia, "principal");
      expect(link.role).toBe("principal");
      expect(await listPeopleOfCompany(client, companyId)).toHaveLength(1);
    });
  });
});
