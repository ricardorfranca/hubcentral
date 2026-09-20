import { describe, it, expect, afterAll, beforeAll } from "vitest";
import type { FastifyInstance } from "fastify";
import type { PoolClient } from "pg";
import { getTestPool, closeTestPool } from "../helpers/db.js";
import { buildApp } from "../../src/http/app.js";
import { setPassword } from "../../src/core/iam/identity-service.js";
import { grantNamespace } from "../../src/core/iam/rbac.js";

/**
 * @file users-api.test.ts
 *
 * Testes das rotas de administração de usuários (IAM): autorização por
 * core:usuarios:gerenciar, convite, alteração de papel e edição de permissões.
 */

let app: FastifyInstance;
let adminToken: string;
let plainToken: string;

async function withClient<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await getTestPool().connect();
  try {
    return await fn(c);
  } finally {
    c.release();
  }
}

/** Cria um usuário com senha definida e retorna o token de login. */
async function makeUserAndLogin(admin: boolean): Promise<string> {
  const email = `u-${Math.random().toString(36).slice(2)}@example.com`;
  const { rows } = await getTestPool().query<{ id: string }>(
    `INSERT INTO core.users (email, full_name, password_set) VALUES ($1, 'U', true) RETURNING id`,
    [email],
  );
  const id = rows[0]!.id;
  await withClient((c) => setPassword(c, id, "senha123"));
  if (admin) {
    await withClient((c) => grantNamespace(c, id, "core:usuarios:gerenciar"));
  }
  const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: "senha123" } });
  return res.json().token;
}

beforeAll(async () => {
  app = buildApp(getTestPool());
  await app.ready();
  adminToken = await makeUserAndLogin(true);
  plainToken = await makeUserAndLogin(false);
});

afterAll(async () => {
  await app.close();
  await closeTestPool();
});

describe("Administração de usuários", () => {
  it("nega acesso sem a permissão core:usuarios:gerenciar (403)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/iam/users",
      headers: { authorization: `Bearer ${plainToken}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("admin lista, convida, altera papel e edita permissões", async () => {
    const auth = { authorization: `Bearer ${adminToken}` };

    // Listar (admin tem acesso).
    const list = await app.inject({ method: "GET", url: "/api/iam/users", headers: auth });
    expect(list.statusCode).toBe(200);
    expect(Array.isArray(list.json())).toBe(true);

    // Convidar.
    const email = `novo-${Math.random().toString(36).slice(2)}@example.com`;
    const invited = await app.inject({
      method: "POST",
      url: "/api/iam/users",
      headers: auth,
      payload: { email, full_name: "Novo", role: "operator" },
    });
    expect(invited.statusCode).toBe(201);
    const newId = invited.json().id;
    expect(invited.json().password_set).toBe(false);

    // Alterar papel.
    const patched = await app.inject({
      method: "PATCH",
      url: `/api/iam/users/${newId}`,
      headers: auth,
      payload: { role: "module_admin" },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().role).toBe("module_admin");

    // Editar permissões (set) e reler.
    const putPerms = await app.inject({
      method: "PUT",
      url: `/api/iam/users/${newId}/permissions`,
      headers: auth,
      payload: { permissions: ["crm:pipeline:visualizar", "crm:pipeline:mover"] },
    });
    expect(putPerms.statusCode).toBe(204);

    const getPerms = await app.inject({ method: "GET", url: `/api/iam/users/${newId}/permissions`, headers: auth });
    expect(new Set(getPerms.json().permissions)).toEqual(
      new Set(["crm:pipeline:visualizar", "crm:pipeline:mover"]),
    );
  });

  it("expõe o catálogo de namespaces para o admin", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/iam/namespaces",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().namespaces).toContain("crm:pipeline:mover");
  });
});
