/**
 * @file contacts.ts
 * @module http/routes
 *
 * Rotas HTTP da Base Central de Contatos e de segmentos. Cada handler abre uma
 * transação e delega aos serviços do núcleo, injetando o `userId` autenticado.
 */

import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { withTransaction } from "../../core/db/pool.js";
import {
  createContact,
  getContactData,
  updateContact,
  deleteContact,
  listContacts,
  type ContactPatch,
} from "../../core/contacts/contact-service.js";
import type { ContactInput } from "../../core/contacts/types.js";
import {
  listCategories, createCustomCategory, assignCategory, unassignCategory,
} from "../../core/contacts/category-service.js";
import { lookupCnpj } from "../../core/contacts/cnpj-lookup.js";
import { lookupCep } from "../../core/contacts/cep-lookup.js";
import {
  linkCompanyPerson, unlinkCompanyPerson, setLinkRole, listPeopleOfCompany,
  isCompanyPersonRole, COMPANY_PERSON_ROLES,
} from "../../core/contacts/link-service.js";
import { DomainError, ErrorCode } from "../../core/errors.js";
import {
  createSegment,
  evaluateSegment,
  type SegmentCriteria,
} from "../../core/contacts/segment-service.js";
import {
  listCustomFieldDefs, defineCustomField, deleteCustomFieldDef,
  listContactCustomFieldValues, setCustomFieldValue, clearCustomFieldValue,
  type CustomFieldDataType,
} from "../../core/contacts/custom-field-service.js";
import { authorize } from "../../core/iam/rbac.js";

/**
 * Registra as rotas de contatos e segmentos na instância Fastify.
 *
 * @param app - Instância Fastify.
 * @param pool - Pool de conexões.
 */
export function registerContactRoutes(app: FastifyInstance, pool: Pool): void {
  // Listar contatos (com rótulos), filtrando por tipo, texto, status de
  // contrato e gerente de contas.
  app.get<{
    Querystring: {
      type?: "pessoa" | "empresa";
      search?: string;
      contract_active?: string;
      account_manager_user_id?: string;
    };
  }>(
    "/api/contacts",
    async (request, reply) => {
      const q = request.query;
      const items = await withTransaction(pool, (client) =>
        listContacts(client, {
          type: q.type,
          search: q.search,
          // Querystring chega como string: só filtra quando explicitamente informado.
          contractActive: q.contract_active === undefined ? undefined : q.contract_active === "true",
          accountManagerUserId: q.account_manager_user_id,
        }),
      );
      return reply.send(items);
    },
  );

  // Consulta de CNPJ para autofill de empresa (dados oficiais).
  app.get<{ Params: { cnpj: string } }>("/api/contacts/cnpj/:cnpj", async (request, reply) => {
    const data = await lookupCnpj(request.params.cnpj);
    if (!data) {
      return reply.status(404).send({ code: "CNPJ_NOT_FOUND", message: "CNPJ não encontrado ou serviço indisponível.", details: {} });
    }
    return reply.send(data);
  });

  // Consulta de CEP para autofill de endereço (logradouro, bairro, cidade, UF).
  app.get<{ Params: { cep: string } }>("/api/contacts/cep/:cep", async (request, reply) => {
    const data = await lookupCep(request.params.cep);
    if (!data) {
      return reply.status(404).send({ code: "CEP_NOT_FOUND", message: "CEP não encontrado ou serviço indisponível.", details: {} });
    }
    return reply.send(data);
  });

  // Vocabulário de papéis do vínculo empresa↔pessoa (para a UI montar o select).
  app.get("/api/contacts/company-roles", async (_request, reply) => {
    return reply.send({ roles: COMPANY_PERSON_ROLES });
  });

  // Categorias (rótulos): listar e criar.
  app.get("/api/contacts/categories", async (_request, reply) => {
    const categories = await withTransaction(pool, (client) => listCategories(client));
    return reply.send(categories);
  });
  app.post<{ Body: { name: string } }>("/api/contacts/categories", async (request, reply) => {
    const category = await withTransaction(pool, (client) => createCustomCategory(client, request.body.name));
    return reply.status(201).send(category);
  });

  // Atribuir/remover rótulo a um contato.
  app.post<{ Params: { id: string }; Body: { category_id: string } }>(
    "/api/contacts/:id/labels",
    async (request, reply) => {
      await withTransaction(pool, (client) => assignCategory(client, request.params.id, request.body.category_id));
      return reply.status(204).send();
    },
  );
  app.delete<{ Params: { id: string; categoryId: string } }>(
    "/api/contacts/:id/labels/:categoryId",
    async (request, reply) => {
      await withTransaction(pool, (client) => unassignCategory(client, request.params.id, request.params.categoryId));
      return reply.status(204).send();
    },
  );

  // Criar contato.
  app.post<{ Body: ContactInput }>("/api/contacts", async (request, reply) => {
    const contact = await withTransaction(pool, (client) =>
      createContact(client, request.body, request.userId),
    );
    return reply.status(201).send(contact);
  });

  // Obter contato por id.
  app.get<{ Params: { id: string } }>("/api/contacts/:id", async (request, reply) => {
    const contact = await withTransaction(pool, (client) =>
      getContactData(client, request.params.id),
    );
    if (!contact) {
      return reply.status(404).send({ code: "CONTACT_NOT_FOUND", message: "Contato não encontrado.", details: {} });
    }
    return reply.send(contact);
  });

  // Atualizar contato (publica core.contato.atualizado).
  app.patch<{ Params: { id: string }; Body: ContactPatch }>(
    "/api/contacts/:id",
    async (request, reply) => {
      const contact = await withTransaction(pool, (client) =>
        updateContact(client, request.params.id, request.body, request.userId),
      );
      return reply.send(contact);
    },
  );

  // Excluir contato (bloqueado se referenciado por módulos).
  app.delete<{ Params: { id: string } }>("/api/contacts/:id", async (request, reply) => {
    await withTransaction(pool, (client) => deleteContact(client, request.params.id));
    return reply.status(204).send();
  });

  // --- Contatos vinculados a uma empresa (responsável principal, técnico, ...) ---

  // Listar as pessoas vinculadas a uma empresa, com seus papéis.
  app.get<{ Params: { id: string } }>("/api/contacts/:id/people", async (request, reply) => {
    const people = await withTransaction(pool, (c) => listPeopleOfCompany(c, request.params.id));
    return reply.send(people);
  });

  // Vincular uma pessoa a uma empresa com um papel do vocabulário canônico.
  app.post<{ Params: { id: string }; Body: { person_id: string; role?: string } }>(
    "/api/contacts/:id/people",
    async (request, reply) => {
      const role = assertCanonicalRole(request.body.role);
      const link = await withTransaction(pool, async (c) => {
        await authorize(c, request.userId, "core:contatos:editar");
        return linkCompanyPerson(c, request.params.id, request.body.person_id, role);
      });
      return reply.status(201).send(link);
    },
  );

  // Alterar o papel de uma pessoa já vinculada à empresa.
  app.patch<{ Params: { id: string; personId: string }; Body: { role?: string | null } }>(
    "/api/contacts/:id/people/:personId",
    async (request, reply) => {
      const role = assertCanonicalRole(request.body.role);
      const link = await withTransaction(pool, async (c) => {
        await authorize(c, request.userId, "core:contatos:editar");
        return setLinkRole(c, request.params.id, request.params.personId, role ?? null);
      });
      return reply.send(link);
    },
  );

  // Desvincular uma pessoa da empresa.
  app.delete<{ Params: { id: string; personId: string } }>(
    "/api/contacts/:id/people/:personId",
    async (request, reply) => {
      await withTransaction(pool, async (c) => {
        await authorize(c, request.userId, "core:contatos:editar");
        await unlinkCompanyPerson(c, request.params.id, request.params.personId);
      });
      return reply.status(204).send();
    },
  );

  // --- Campos personalizados (definições) ---

  // Listar definições de campos personalizados.
  app.get("/api/custom-fields", async (_request, reply) => {
    const defs = await withTransaction(pool, (c) => listCustomFieldDefs(c));
    return reply.send(defs);
  });

  // Criar uma definição de campo personalizado (admin de configurações).
  app.post<{ Body: { name: string; data_type: CustomFieldDataType } }>(
    "/api/custom-fields",
    async (request, reply) => {
      const def = await withTransaction(pool, async (c) => {
        await authorize(c, request.userId, "core:config:gerenciar");
        return defineCustomField(c, request.body.name, request.body.data_type);
      });
      return reply.status(201).send(def);
    },
  );

  // Remover uma definição de campo personalizado (e seus valores, em cascata).
  app.delete<{ Params: { fieldId: string } }>(
    "/api/custom-fields/:fieldId",
    async (request, reply) => {
      await withTransaction(pool, async (c) => {
        await authorize(c, request.userId, "core:config:gerenciar");
        await deleteCustomFieldDef(c, request.params.fieldId);
      });
      return reply.status(204).send();
    },
  );

  // --- Campos personalizados (valores por contato) ---

  // Listar os valores de campos personalizados de um contato.
  app.get<{ Params: { id: string } }>(
    "/api/contacts/:id/custom-fields",
    async (request, reply) => {
      const values = await withTransaction(pool, (c) => listContactCustomFieldValues(c, request.params.id));
      return reply.send(values);
    },
  );

  // Definir/atualizar o valor de um campo personalizado de um contato.
  app.put<{ Params: { id: string; fieldId: string }; Body: { value: unknown } }>(
    "/api/contacts/:id/custom-fields/:fieldId",
    async (request, reply) => {
      await withTransaction(pool, async (c) => {
        await authorize(c, request.userId, "core:contatos:editar");
        await setCustomFieldValue(c, request.params.id, request.params.fieldId, request.body.value);
      });
      return reply.status(204).send();
    },
  );

  // Remover o valor de um campo personalizado de um contato.
  app.delete<{ Params: { id: string; fieldId: string } }>(
    "/api/contacts/:id/custom-fields/:fieldId",
    async (request, reply) => {
      await withTransaction(pool, async (c) => {
        await authorize(c, request.userId, "core:contatos:editar");
        await clearCustomFieldValue(c, request.params.id, request.params.fieldId);
      });
      return reply.status(204).send();
    },
  );

  // Criar segmento persistido.
  app.post<{ Body: { name: string; criteria: SegmentCriteria } }>(
    "/api/segments",
    async (request, reply) => {
      const userId = request.userId;
      if (!userId) {
        return reply.status(401).send({ code: "AUTH_UNAUTHORIZED", message: "Requisição não autenticada.", details: {} });
      }
      const segment = await withTransaction(pool, (client) =>
        createSegment(client, request.body.name, request.body.criteria, userId),
      );
      return reply.status(201).send(segment);
    },
  );

  // Avaliar critérios de segmento (retorna apenas contact_id).
  app.post<{ Body: SegmentCriteria }>("/api/segments/evaluate", async (request, reply) => {
    const ids = await withTransaction(pool, (client) => evaluateSegment(client, request.body));
    return reply.send({ contact_ids: ids });
  });
}

/**
 * Valida que o papel informado pertence ao vocabulário canônico de vínculos
 * empresa↔pessoa. A coluna aceita texto livre por compatibilidade, mas a API
 * pública só oferece os papéis conhecidos, para manter os dados consistentes.
 *
 * @param role - Papel recebido no corpo da requisição.
 * @returns O papel validado, ou `undefined` se não informado.
 * @throws {DomainError} `LINK_INVALID_ROLE` se o papel não for reconhecido.
 */
function assertCanonicalRole(role: string | null | undefined): string | undefined {
  if (role == null || role.trim() === "") return undefined;
  if (!isCompanyPersonRole(role)) {
    throw new DomainError(
      ErrorCode.LINK_INVALID_ROLE,
      `Papel inválido. Use um destes: ${COMPANY_PERSON_ROLES.join(", ")}.`,
      { role, allowed: COMPANY_PERSON_ROLES },
    );
  }
  return role;
}
