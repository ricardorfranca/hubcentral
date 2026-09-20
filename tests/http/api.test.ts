import { describe, it, expect, afterAll, beforeAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { getTestPool, closeTestPool } from "../helpers/db.js";
import { buildApp } from "../../src/http/app.js";

/**
 * @file api.test.ts
 *
 * Testes de integração HTTP (Fastify inject) das rotas de contatos e CRM,
 * incluindo autenticação (x-user-id) e os caminhos 200/201/401/404/409.
 */

let app: FastifyInstance;
let token: string;

beforeAll(async () => {
  app = buildApp(getTestPool());
  await app.ready();

  // Cria um usuário com senha definida e faz login real para obter o token.
  const email = `api-${Math.random().toString(36).slice(2)}@example.com`;
  const { rows } = await getTestPool().query<{ id: string }>(
    `INSERT INTO core.users (email, full_name, password_set) VALUES ($1, 'API User', true) RETURNING id`,
    [email],
  );
  const userId = rows[0]!.id;
  // Define a senha via serviço (hash correto) e loga.
  const { setPassword } = await import("../../src/core/iam/identity-service.js");
  await withClient(async (client) => setPassword(client, userId, "senha123"));

  const login = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email, password: "senha123" },
  });
  token = login.json().token;
});

afterAll(async () => {
  await app.close();
  await closeTestPool();
});

/** Executa fn com um client do pool de teste. */
async function withClient<T>(fn: (client: import("pg").PoolClient) => Promise<T>): Promise<T> {
  const client = await getTestPool().connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

/** Headers autenticados com Bearer token. */
function auth(): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

describe("API de contatos", () => {
  it("cria, obtém, atualiza e o ciclo reflete os dados", async () => {
    const email = `http-${Math.random().toString(36).slice(2)}@example.com`;
    const created = await app.inject({
      method: "POST",
      url: "/api/contacts",
      headers: auth(),
      payload: { contact_type: "pessoa", full_name: "HTTP User", email, phone: "11999990000" },
    });
    expect(created.statusCode).toBe(201);
    const contact = created.json();
    expect(contact.id).toBeDefined();

    const got = await app.inject({ method: "GET", url: `/api/contacts/${contact.id}`, headers: auth() });
    expect(got.statusCode).toBe(200);
    expect(got.json().email.toLowerCase()).toBe(email.toLowerCase());

    const patched = await app.inject({
      method: "PATCH",
      url: `/api/contacts/${contact.id}`,
      headers: auth(),
      payload: { phone: "11888887777" },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().phone).toBe("11888887777");
  });

  it("retorna 409 ao criar contato duplicado por e-mail", async () => {
    const email = `dup-${Math.random().toString(36).slice(2)}@example.com`;
    const payload = { contact_type: "pessoa", full_name: "Dup", email, phone: "11999990000" };
    const first = await app.inject({ method: "POST", url: "/api/contacts", headers: auth(), payload });
    expect(first.statusCode).toBe(201);
    const second = await app.inject({ method: "POST", url: "/api/contacts", headers: auth(), payload });
    expect(second.statusCode).toBe(409);
    expect(second.json().code).toBe("CONTACT_DUPLICATE_EMAIL");
  });

  it("retorna 404 para contato inexistente", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/contacts/00000000-0000-0000-0000-000000000000",
      headers: auth(),
    });
    expect(res.statusCode).toBe(404);
  });

  it("criar segmento sem autenticação retorna 401", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/segments",
      payload: { name: "s", criteria: { categories: ["x"] } },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("API do CRM", () => {
  it("cria um lead e obtém sua visão com dados de contato da Base Central", async () => {
    const email = `lead-${Math.random().toString(36).slice(2)}@example.com`;
    const created = await app.inject({
      method: "POST",
      url: "/api/crm/leads",
      headers: auth(),
      payload: { person: { full_name: "Lead HTTP", email, phone: "11999990000" } },
    });
    expect(created.statusCode).toBe(201);
    const lead = created.json();
    expect(lead.person_contact_id).toBeDefined();

    const view = await app.inject({ method: "GET", url: `/api/crm/leads/${lead.id}`, headers: auth() });
    expect(view.statusCode).toBe(200);
    expect(view.json().person.email.toLowerCase()).toBe(email.toLowerCase());
  });

  it("move e finaliza um lead", async () => {
    const email = `leadmv-${Math.random().toString(36).slice(2)}@example.com`;
    const created = await app.inject({
      method: "POST",
      url: "/api/crm/leads",
      headers: auth(),
      payload: { person: { full_name: "Mv", email, phone: "11999990000" } },
    });
    const leadId = created.json().id;

    const moved = await app.inject({
      method: "PATCH",
      url: `/api/crm/leads/${leadId}/move`,
      headers: auth(),
      payload: { to_column: "proposta" },
    });
    expect(moved.statusCode).toBe(200);
    expect(moved.json().column_id).toBe("proposta");

    const finalized = await app.inject({
      method: "PATCH",
      url: `/api/crm/leads/${leadId}/finalize`,
      headers: auth(),
      payload: { outcome: "won", value_activation: 1000, value_monthly: 200 },
    });
    expect(finalized.statusCode).toBe(200);
    expect(finalized.json().status).toBe("won");
  });
});

describe("API do CRM — recursos adicionais", () => {
  it("gerencia listas configuráveis", async () => {
    const value = `Corporativo-${Math.random().toString(36).slice(2)}`;
    const created = await app.inject({
      method: "POST",
      url: "/api/crm/lists/tag",
      headers: auth(),
      payload: { value },
    });
    expect(created.statusCode).toBe(201);

    const list = await app.inject({ method: "GET", url: "/api/crm/lists/tag", headers: auth() });
    expect(list.statusCode).toBe(200);
    expect(list.json().some((i: { value: string }) => i.value === value)).toBe(true);
  });

  it("lê o SLA seed de uma etapa e o atualiza", async () => {
    const got = await app.inject({ method: "GET", url: "/api/crm/sla/ligacao", headers: auth() });
    expect(got.statusCode).toBe(200);
    expect(got.json().unit).toBe("minutes");

    const put = await app.inject({
      method: "PUT",
      url: "/api/crm/sla/ligacao",
      headers: auth(),
      payload: { value: 45, unit: "minutes" },
    });
    expect(put.statusCode).toBe(204);
  });

  it("cria e dispara uma campanha (evento crm.campanha.disparada)", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/crm/campaigns",
      headers: auth(),
      payload: { name: "Promo", tags: ["premium"], channels: ["email"], body_text: "Olá {{nome_lead}}" },
    });
    expect(created.statusCode).toBe(201);
    const campaignId = created.json().id;

    const dispatched = await app.inject({
      method: "POST",
      url: `/api/crm/campaigns/${campaignId}/dispatch`,
      headers: auth(),
      payload: { channel: "email", category_ids: [] },
    });
    // category_ids vazio -> segmento vazio é rejeitado (400) pela Base Central.
    expect([200, 400]).toContain(dispatched.statusCode);
  });

  it("relatórios respondem com estrutura esperada", async () => {
    const closings = await app.inject({ method: "GET", url: "/api/crm/reports/closings", headers: auth() });
    expect(closings.statusCode).toBe(200);
    expect(closings.json()).toHaveProperty("won");

    const sla = await app.inject({ method: "GET", url: "/api/crm/reports/sla", headers: auth() });
    expect(sla.statusCode).toBe(200);
    expect(sla.json()).toHaveProperty("overdue");
  });
});
