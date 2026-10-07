import { describe, it, expect, afterAll, beforeAll } from "vitest";
import type { FastifyInstance } from "fastify";
import type { PoolClient } from "pg";
import { withRollback, getTestPool, closeTestPool } from "./helpers/db.js";
import { buildApp } from "../src/http/app.js";
import {
  inviteUser,
  setUserProfile,
  setPassword,
  getUserById,
} from "../src/core/iam/identity-service.js";
import { grantNamespace } from "../src/core/iam/rbac.js";
import { DomainError, ErrorCode } from "../src/core/errors.js";

/**
 * @file iam-user-profile.test.ts
 *
 * Testes da edição de nome/e-mail de usuário (RF1): o serviço setUserProfile
 * (withRollback) e a rota PATCH /api/iam/users/:id (buildApp + app.inject).
 */

let seq = 0;
/** Convida um usuário de teste com e-mail único. */
async function invite(client: PoolClient): Promise<{ id: string; email: string }> {
  seq += 1;
  const email = `prof${seq}-${Math.random().toString(36).slice(2)}@example.com`;
  const u = await inviteUser(client, { email, full_name: `User ${seq}`, role: "operator" });
  return { id: u.id, email };
}

describe("setUserProfile (serviço)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("atualiza só o nome, preservando o e-mail", async () => {
    await withRollback(async (client) => {
      const { id, email } = await invite(client);
      const updated = await setUserProfile(client, id, { full_name: "Novo Nome" }, null);
      expect(updated.full_name).toBe("Novo Nome");
      expect(updated.email).toBe(email);
    });
  });

  it("atualiza só o e-mail, preservando o nome", async () => {
    await withRollback(async (client) => {
      const { id } = await invite(client);
      const before = await getUserById(client, id);
      const novo = `troca-${Math.random().toString(36).slice(2)}@example.com`;
      const updated = await setUserProfile(client, id, { email: novo }, null);
      expect(updated.email).toBe(novo);
      expect(updated.full_name).toBe(before!.full_name);
    });
  });

  it("atualiza nome e e-mail juntos", async () => {
    await withRollback(async (client) => {
      const { id } = await invite(client);
      const novo = `ambos-${Math.random().toString(36).slice(2)}@example.com`;
      const updated = await setUserProfile(client, id, { full_name: "Dois Campos", email: novo }, null);
      expect(updated.full_name).toBe("Dois Campos");
      expect(updated.email).toBe(novo);
    });
  });

  it("chamada sem campos não altera dados nem gera auditoria", async () => {
    await withRollback(async (client) => {
      const { id } = await invite(client);
      const antes = await client.query<{ c: string }>(
        `SELECT count(*)::text AS c FROM core.system_logs WHERE action = 'IAM_PERFIL_ALTERADO'`,
      );
      const before = await getUserById(client, id);
      const updated = await setUserProfile(client, id, {}, null);
      expect(updated).toEqual(before);
      const depois = await client.query<{ c: string }>(
        `SELECT count(*)::text AS c FROM core.system_logs WHERE action = 'IAM_PERFIL_ALTERADO'`,
      );
      expect(depois.rows[0]!.c).toBe(antes.rows[0]!.c);
    });
  });

  it("nome em branco -> IAM_INVALID_NAME e registro inalterado", async () => {
    await withRollback(async (client) => {
      const { id } = await invite(client);
      const before = await getUserById(client, id);
      try {
        await setUserProfile(client, id, { full_name: "   " }, null);
        expect.unreachable("deveria rejeitar nome em branco");
      } catch (err) {
        expect((err as DomainError).code).toBe(ErrorCode.IAM_INVALID_NAME);
      }
      const after = await getUserById(client, id);
      expect(after).toEqual(before);
    });
  });

  it("e-mail de outro usuário -> IAM_EMAIL_TAKEN e inalterado", async () => {
    await withRollback(async (client) => {
      const a = await invite(client);
      const b = await invite(client);
      try {
        await setUserProfile(client, a.id, { email: b.email }, null);
        expect.unreachable("deveria rejeitar e-mail já usado");
      } catch (err) {
        expect((err as DomainError).code).toBe(ErrorCode.IAM_EMAIL_TAKEN);
      }
      const after = await getUserById(client, a.id);
      expect(after!.email).toBe(a.email);
    });
  });

  it("reenviar o próprio e-mail é aceito", async () => {
    await withRollback(async (client) => {
      const { id, email } = await invite(client);
      const updated = await setUserProfile(client, id, { email }, null);
      expect(updated.email).toBe(email);
    });
  });

  it("e-mail no domínio reservado -> IAM_INVALID_EMAIL", async () => {
    await withRollback(async (client) => {
      const { id } = await invite(client);
      try {
        await setUserProfile(client, id, { email: "qualquer@deleted.local" }, null);
        expect.unreachable("deveria rejeitar o domínio reservado");
      } catch (err) {
        expect((err as DomainError).code).toBe(ErrorCode.IAM_INVALID_EMAIL);
      }
    });
  });

  it(":id inexistente -> IAM_USER_NOT_FOUND", async () => {
    await withRollback(async (client) => {
      try {
        await setUserProfile(client, "00000000-0000-0000-0000-000000000000", { full_name: "X" }, null);
        expect.unreachable("deveria rejeitar usuário inexistente");
      } catch (err) {
        expect((err as DomainError).code).toBe(ErrorCode.IAM_USER_NOT_FOUND);
      }
    });
  });

  it("cada edição gera exatamente 1 log com payloads e autor corretos", async () => {
    await withRollback(async (client) => {
      const actor = await invite(client);
      const { id } = await invite(client);
      const before = await getUserById(client, id);
      await setUserProfile(client, id, { full_name: "Auditado" }, actor.id);
      const { rows } = await client.query<{
        user_id: string;
        payload_before: { full_name?: string };
        payload_after: { full_name?: string };
      }>(
        `SELECT user_id, payload_before, payload_after FROM core.system_logs
         WHERE action = 'IAM_PERFIL_ALTERADO'`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.user_id).toBe(actor.id);
      expect(rows[0]!.payload_before.full_name).toBe(before!.full_name);
      expect(rows[0]!.payload_after.full_name).toBe("Auditado");
    });
  });
});

describe("PATCH /api/iam/users/:id — perfil (rota)", () => {
  let app: FastifyInstance;
  let adminToken: string;

  async function withClient<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await getTestPool().connect();
    try {
      return await fn(c);
    } finally {
      c.release();
    }
  }

  /** Cria um usuário com senha e retorna id + token de login. */
  async function makeUserAndLogin(admin: boolean): Promise<{ id: string; token: string }> {
    const email = `route-${Math.random().toString(36).slice(2)}@example.com`;
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
    return { id, token: res.json().token };
  }

  beforeAll(async () => {
    app = buildApp(getTestPool());
    await app.ready();
    adminToken = (await makeUserAndLogin(true)).token;
  });

  afterAll(async () => {
    await app.close();
    await closeTestPool();
  });

  it("edita nome e e-mail via rota", async () => {
    const auth = { authorization: `Bearer ${adminToken}` };
    const target = await makeUserAndLogin(false);
    const novo = `patched-${Math.random().toString(36).slice(2)}@example.com`;
    const res = await app.inject({
      method: "PATCH",
      url: `/api/iam/users/${target.id}`,
      headers: auth,
      payload: { full_name: "Editado", email: novo },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().full_name).toBe("Editado");
    expect(res.json().email).toBe(novo);
  });

  it("combina perfil com papel/status sem regressão", async () => {
    const auth = { authorization: `Bearer ${adminToken}` };
    const target = await makeUserAndLogin(false);
    const res = await app.inject({
      method: "PATCH",
      url: `/api/iam/users/${target.id}`,
      headers: auth,
      payload: { full_name: "Combo", role: "module_admin", status: "disabled" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().full_name).toBe("Combo");
    expect(res.json().role).toBe("module_admin");
    expect(res.json().status).toBe("disabled");
  });

  it("e-mail duplicado responde 409 na rota", async () => {
    const auth = { authorization: `Bearer ${adminToken}` };
    const a = await makeUserAndLogin(false);
    const b = await makeUserAndLogin(false);
    const bUser = await withClient((c) => getUserById(c, b.id));
    const res = await app.inject({
      method: "PATCH",
      url: `/api/iam/users/${a.id}`,
      headers: auth,
      payload: { email: bUser!.email },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("IAM_EMAIL_TAKEN");
  });

  it(":id inexistente responde 404", async () => {
    const auth = { authorization: `Bearer ${adminToken}` };
    const res = await app.inject({
      method: "PATCH",
      url: `/api/iam/users/00000000-0000-0000-0000-000000000000`,
      headers: auth,
      payload: { full_name: "X" },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("IAM_USER_NOT_FOUND");
  });
});
