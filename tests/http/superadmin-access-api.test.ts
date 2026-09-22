import { describe, it, expect, afterAll, beforeAll } from "vitest";
import type { FastifyInstance } from "fastify";
import type { PoolClient } from "pg";
import { getTestPool, closeTestPool } from "../helpers/db.js";
import { buildApp } from "../../src/http/app.js";
import { setPassword } from "../../src/core/iam/identity-service.js";
import { grantNamespace } from "../../src/core/iam/rbac.js";
import { ALL_NAMESPACES } from "../../src/core/iam/namespaces.js";

/**
 * @file superadmin-access-api.test.ts
 *
 * Testes de integração de rota do bugfix `superadmin-full-access`. Exercitam a
 * autorização de ponta a ponta (login -> token -> rota protegida por namespace)
 * validando que:
 *  - Um SuperAdministrador acessa uma rota protegida por um namespace NÃO
 *    concedido (namespace novo introduzido após o bootstrap) — Req 2.1, 2.2.
 *  - Rebaixar o SuperAdministrador para papel comum faz a autorização voltar a
 *    depender de `hasNamespace` (o bypass deixa de valer) — Req 3.1, 3.2.
 *  - Um usuário comum acessa a rota com o namespace concedido (autorizado) e é
 *    negado sem o namespace (RBAC_ACCESS_DENIED) — Req 3.1, 3.2.
 *
 * Segue o padrão de `projetos-api.test.ts`: `buildApp` + `app.inject`, dados
 * commitados no pool de teste com e-mails únicos por caso (sem rollback, pois a
 * rota abre suas próprias transações).
 *
 * Rota protegida escolhida: `PATCH /api/settings/core.branding.system_name`,
 * guardada por `core:config:gerenciar` (ver `src/http/routes/settings.ts`). O
 * corpo é válido para que a única barreira observável seja a autorização RBAC.
 * (A criação de campos personalizados deixou de servir como rota-exemplo por
 * passar a exigir SuperAdministrador, e não apenas o namespace de configuração.)
 */

let app: FastifyInstance;

/** Namespace exigido pela rota protegida usada nos testes. */
const PROTECTED_NS = "core:config:gerenciar";

async function withClient<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await getTestPool().connect();
  try {
    return await fn(c);
  } finally {
    c.release();
  }
}

function auth(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

/** Faz login e retorna o token de sessão. */
async function login(email: string, password: string): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email, password },
  });
  expect(res.statusCode).toBe(200);
  return res.json().token as string;
}

/**
 * Requisição à rota protegida (PATCH /api/settings/:key) com corpo válido,
 * guardada apenas por `core:config:gerenciar`. Retorna 200 quando autorizada.
 */
async function callProtected(
  token: string,
): Promise<Awaited<ReturnType<FastifyInstance["inject"]>>> {
  return app.inject({
    method: "PATCH",
    url: "/api/settings/core.branding.system_name",
    headers: auth(token),
    payload: { value: null },
  });
}

/**
 * Reproduz o bootstrap do SuperAdministrador (upsert como `createAdmin`),
 * porém concedendo todos os namespaces EXCETO um — simulando um namespace novo
 * introduzido após o bootstrap, que nunca chegou a ser concedido.
 */
async function bootstrapSuperadmin(
  email: string,
  password: string,
  excludeNamespace: string,
): Promise<string> {
  const { rows } = await getTestPool().query<{ id: string }>(
    `INSERT INTO core.users (email, full_name, role, status, password_set)
     VALUES ($1, 'Super Administrador', 'superadmin', 'active', true)
     ON CONFLICT (email) DO UPDATE
       SET role = 'superadmin', status = 'active', password_set = true
     RETURNING id`,
    [email],
  );
  const id = rows[0]!.id;
  await withClient((c) => setPassword(c, id, password));
  // Concede todo o catálogo conhecido, menos o namespace "novo/não concedido".
  await withClient(async (c) => {
    for (const ns of ALL_NAMESPACES) {
      if (ns !== excludeNamespace) await grantNamespace(c, id, ns);
    }
  });
  return id;
}

/** Cria um usuário comum com senha e, opcionalmente, o namespace protegido. */
async function makeCommonUser(
  email: string,
  password: string,
  withProtectedNs: boolean,
): Promise<string> {
  const { rows } = await getTestPool().query<{ id: string }>(
    `INSERT INTO core.users (email, full_name, password_set)
     VALUES ($1, 'Usuário Comum', true) RETURNING id`,
    [email],
  );
  const id = rows[0]!.id;
  await withClient((c) => setPassword(c, id, password));
  if (withProtectedNs) {
    await withClient((c) => grantNamespace(c, id, PROTECTED_NS));
  }
  return id;
}

beforeAll(async () => {
  app = buildApp(getTestPool());
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await closeTestPool();
});

describe("SuperAdmin full access — integração de rota", () => {
  // Req 2.1, 2.2: SuperAdministrador criado via bootstrap acessa uma rota cujo
  // namespace NÃO lhe foi concedido (namespace novo após o bootstrap). A rota
  // deve autorizar de ponta a ponta (não 403).
  it("Req 2.1/2.2: superadmin acessa rota com namespace não concedido", async () => {
    const email = `sa-${Math.random().toString(36).slice(2)}@hubcentral.local`;
    const password = "adminpass1";
    const id = await bootstrapSuperadmin(email, password, PROTECTED_NS);

    // Sanidade: o namespace protegido realmente não foi concedido.
    const has = await withClient(async (c) => {
      const { rows } = await c.query<{ exists: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM core.user_permissions WHERE user_id = $1 AND namespace = $2) AS exists`,
        [id, PROTECTED_NS],
      );
      return rows[0]!.exists;
    });
    expect(has).toBe(false);

    const token = await login(email, password);
    const res = await callProtected(token);

    // O bypass de superadmin autoriza: não pode ser 403 (RBAC_ACCESS_DENIED).
    expect(res.statusCode).not.toBe(403);
    expect(res.statusCode).toBe(200);
  });

  // Req 3.1, 3.2: ao rebaixar o SuperAdministrador para papel comum, a
  // autorização volta a depender de `hasNamespace`. Sem o namespace concedido,
  // a mesma rota passa a negar com 403 (RBAC_ACCESS_DENIED).
  it("Req 3.1/3.2: rebaixar superadmin faz a autorização voltar a depender de hasNamespace", async () => {
    const email = `toggle-${Math.random().toString(36).slice(2)}@hubcentral.local`;
    const password = "adminpass1";
    const id = await bootstrapSuperadmin(email, password, PROTECTED_NS);

    // Enquanto superadmin: autorizado mesmo sem o namespace.
    const tokenAsSuper = await login(email, password);
    const authorized = await callProtected(tokenAsSuper);
    expect(authorized.statusCode).toBe(200);

    // Rebaixa para papel comum (não-superadmin: 'operator', conforme o CHECK de role).
    await getTestPool().query(
      `UPDATE core.users SET role = 'operator' WHERE id = $1`,
      [id],
    );

    // Novo login/token após a mudança de papel; a rota agora nega (403), pois o
    // namespace protegido nunca foi concedido a este usuário.
    const tokenAsCommon = await login(email, password);
    const denied = await callProtected(tokenAsCommon);
    expect(denied.statusCode).toBe(403);
    expect(denied.json().code).toBe("RBAC_ACCESS_DENIED");
  });

  // Req 3.1, 3.2: regressão de usuário comum — com o namespace concedido a rota
  // autoriza; sem o namespace, nega com 403 (RBAC_ACCESS_DENIED).
  it("Req 3.1/3.2: usuário comum é autorizado com o namespace e negado sem ele", async () => {
    const password = "userpass1";

    // COM o namespace concedido: autorizado.
    const emailWith = `com-ok-${Math.random().toString(36).slice(2)}@x.com`;
    await makeCommonUser(emailWith, password, true);
    const tokenWith = await login(emailWith, password);
    const okRes = await callProtected(tokenWith);
    expect(okRes.statusCode).toBe(200);

    // SEM o namespace: negado com RBAC_ACCESS_DENIED.
    const emailWithout = `com-no-${Math.random().toString(36).slice(2)}@x.com`;
    await makeCommonUser(emailWithout, password, false);
    const tokenWithout = await login(emailWithout, password);
    const deniedRes = await callProtected(tokenWithout);
    expect(deniedRes.statusCode).toBe(403);
    expect(deniedRes.json().code).toBe("RBAC_ACCESS_DENIED");
  });
});
