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
  listEntityCustomFieldValues, setEntityCustomFieldValue, clearEntityCustomFieldValue,
  isCustomFieldEntity, DEFAULT_CUSTOM_FIELD_ENTITY,
  type CustomFieldDataType, type CustomFieldEntity,
} from "../../core/contacts/custom-field-service.js";
import { authorize, isSuperadmin } from "../../core/iam/rbac.js";

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

  // Listar definições de campos personalizados de uma entidade (default:
  // contact). A leitura exige apenas visualizar contatos — as telas de qualquer
  // módulo precisam listar os campos disponíveis para exibi-los.
  app.get<{ Querystring: { entity?: string } }>("/api/custom-fields", async (request, reply) => {
    const entity = resolveEntity(request.query.entity);
    const defs = await withTransaction(pool, (c) => listCustomFieldDefs(c, entity));
    return reply.send(defs);
  });

  // Criar uma definição de campo personalizado. A GESTÃO das definições é
  // exclusiva do SuperAdministrador (módulo a módulo, via entidade).
  app.post<{ Body: { name: string; data_type: CustomFieldDataType; entity?: string } }>(
    "/api/custom-fields",
    async (request, reply) => {
      const entity = resolveEntity(request.body.entity);
      const def = await withTransaction(pool, async (c) => {
        await requireSuperadminField(c, request.userId);
        return defineCustomField(c, request.body.name, request.body.data_type, entity);
      });
      return reply.status(201).send(def);
    },
  );

  // Remover uma definição de campo personalizado (e seus valores, em cascata).
  // Exclusivo do SuperAdministrador.
  app.delete<{ Params: { fieldId: string } }>(
    "/api/custom-fields/:fieldId",
    async (request, reply) => {
      await withTransaction(pool, async (c) => {
        await requireSuperadminField(c, request.userId);
        await deleteCustomFieldDef(c, request.params.fieldId);
      });
      return reply.status(204).send();
    },
  );

  // --- Campos personalizados (valores de entidades genéricas) ---
  // Ex.: /api/entities/crm_opportunity/<uuid>/custom-fields
  //      /api/entities/projetos_task/<uuid>/custom-fields
  // Contatos continuam nas rotas /api/contacts/:id/custom-fields (abaixo).

  // Listar os valores de campos personalizados de um registro de entidade.
  app.get<{ Params: { entity: string; entityId: string } }>(
    "/api/entities/:entity/:entityId/custom-fields",
    async (request, reply) => {
      const entity = requireGenericEntity(request.params.entity);
      const values = await withTransaction(pool, async (c) => {
        await authorize(c, request.userId, "core:contatos:visualizar");
        return listEntityCustomFieldValues(c, entity, request.params.entityId);
      });
      return reply.send(values);
    },
  );

  // Definir/atualizar o valor de um campo personalizado de um registro.
  app.put<{ Params: { entity: string; entityId: string; fieldId: string }; Body: { value: unknown } }>(
    "/api/entities/:entity/:entityId/custom-fields/:fieldId",
    async (request, reply) => {
      const entity = requireGenericEntity(request.params.entity);
      await withTransaction(pool, async (c) => {
        await authorize(c, request.userId, "core:contatos:editar");
        await setEntityCustomFieldValue(c, entity, request.params.entityId, request.params.fieldId, request.body.value);
      });
      return reply.status(204).send();
    },
  );

  // Remover o valor de um campo personalizado de um registro.
  app.delete<{ Params: { entity: string; entityId: string; fieldId: string } }>(
    "/api/entities/:entity/:entityId/custom-fields/:fieldId",
    async (request, reply) => {
      const entity = requireGenericEntity(request.params.entity);
      await withTransaction(pool, async (c) => {
        await authorize(c, request.userId, "core:contatos:editar");
        await clearEntityCustomFieldValue(c, entity, request.params.entityId, request.params.fieldId);
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

/**
 * Resolve a entidade da querystring/body para definições de campos, aceitando
 * ausência (default: contato) e rejeitando valores desconhecidos.
 *
 * @param entity - Valor informado (querystring/body), ou `undefined`.
 * @returns A entidade válida.
 * @throws {DomainError} `CUSTOM_FIELD_NOT_FOUND` se a entidade for desconhecida.
 */
function resolveEntity(entity: string | undefined): CustomFieldEntity {
  if (entity === undefined || entity === "") return DEFAULT_CUSTOM_FIELD_ENTITY;
  if (!isCustomFieldEntity(entity)) {
    throw new DomainError(ErrorCode.CUSTOM_FIELD_NOT_FOUND, "Entidade de campo personalizado desconhecida.", { entity });
  }
  return entity;
}

/**
 * Valida a entidade de uma rota de VALORES genéricos (não-contato). Contatos têm
 * rotas dedicadas, então `contact` é rejeitado aqui.
 *
 * @param entity - Valor do parâmetro de rota.
 * @returns A entidade genérica válida.
 * @throws {DomainError} `CUSTOM_FIELD_NOT_FOUND` se desconhecida ou for `contact`.
 */
function requireGenericEntity(entity: string): CustomFieldEntity {
  if (!isCustomFieldEntity(entity) || entity === "contact") {
    throw new DomainError(ErrorCode.CUSTOM_FIELD_NOT_FOUND, "Entidade de campo personalizado inválida.", { entity });
  }
  return entity;
}

/**
 * Exige que o autor seja SuperAdministrador para gerir DEFINIÇÕES de campos
 * personalizados (criar/remover). A gestão dos campos é exclusiva do superadmin;
 * a atribuição de valores segue o RBAC de cada módulo.
 *
 * @param client - Cliente PostgreSQL.
 * @param userId - `user_id` autenticado.
 * @throws {DomainError} `AUTH_UNAUTHORIZED`/`RBAC_ACCESS_DENIED`.
 */
async function requireSuperadminField(
  client: import("pg").PoolClient,
  userId: string | null,
): Promise<void> {
  if (!userId) {
    throw new DomainError(ErrorCode.AUTH_UNAUTHORIZED, "Requisição não autenticada.", {});
  }
  if (!(await isSuperadmin(client, userId))) {
    throw new DomainError(ErrorCode.RBAC_ACCESS_DENIED, "Apenas o SuperAdministrador pode gerir campos personalizados.", {});
  }
}
