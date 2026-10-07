import { describe, it, expect, afterAll, beforeAll } from "vitest";
import type { FastifyInstance } from "fastify";
import type { PoolClient } from "pg";
import { withRollback, getTestPool, closeTestPool } from "./helpers/db.js";
import { buildApp } from "../src/http/app.js";
import { deleteUser, getUserById, listUsers, setPassword } from "../src/core/iam/identity-service.js";
import { grantNamespace } from "../src/core/iam/rbac.js";
import { log as auditLog } from "../src/core/audit/audit-logger.js";
import { DomainError, ErrorCode } from "../src/core/errors.js";

/**
 * @file iam-user-delete.test.ts
 *
 * Testes de exclusão (lápide) de usuário com reatribuição e preservação de
 * histórico (RF2). Integração com Postgres real (FKs e triggers de
 * imutabilidade de core.system_logs). Serviço com withRollback; rota com
 * app.inject.
 */

type Role = "superadmin" | "module_admin" | "operator" | "client";

let seq = 0;
/** Insere um usuário diretamente, com e-mail único, e devolve id + e-mail. */
async function makeUser(
  client: PoolClient,
  opts: { role?: Role; status?: "active" | "disabled" } = {},
): Promise<{ id: string; email: string }> {
  seq += 1;
  const email = `del${seq}-${Math.random().toString(36).slice(2)}@example.com`;
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO core.users (email, full_name, role, status, password_set)
     VALUES ($1, $2, $3, $4, true) RETURNING id`,
    [email, `User ${seq}`, opts.role ?? "operator", opts.status ?? "active"],
  );
  return { id: rows[0]!.id, email };
}

/** Cria um contato (pessoa) para satisfazer FKs de leads/contatos. */
async function makePersonContact(client: PoolClient): Promise<string> {
  const email = `c${seq}-${Math.random().toString(36).slice(2)}@example.com`;
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO core.contacts (contact_type, full_name, email, phone)
     VALUES ('pessoa', 'Pessoa Teste', $1, '11999999999') RETURNING id`,
    [email],
  );
  return rows[0]!.id;
}

describe("deleteUser (serviço)", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("vira lápide, anonimiza PII e limpa dados por-usuário", async () => {
    await withRollback(async (client) => {
      const victim = await makeUser(client);
      const target = await makeUser(client);

      // Dados por-usuário (categoria 4) a serem removidos.
      await grantNamespace(client, victim.id, "crm:pipeline:visualizar");
      await client.query(
        `INSERT INTO core.sessions (user_id, token_hash, expires_at)
         VALUES ($1, $2, now() + interval '1 day')`,
        [victim.id, `hash-${victim.id}`],
      );
      await client.query(
        `INSERT INTO core.notifications (recipient_user_id, module, type, message)
         VALUES ($1, 'core', 'teste', 'oi')`,
        [victim.id],
      );

      await deleteUser(client, victim.id, target.id, target.id);

      // Lápide: id preservado, status/PII anonimizados.
      const row = await client.query<{
        status: string; full_name: string; email: string;
        password_hash: string | null; password_set: boolean;
        deleted_at: Date | null; deleted_by: string | null;
      }>(
        `SELECT status, full_name, email, password_hash, password_set, deleted_at, deleted_by
         FROM core.users WHERE id = $1`,
        [victim.id],
      );
      const u = row.rows[0]!;
      expect(u.status).toBe("deleted");
      expect(u.full_name).toBe("Usuário excluído");
      expect(u.email).toBe(`deleted+${victim.id}@deleted.local`);
      expect(u.password_hash).toBeNull();
      expect(u.password_set).toBe(false);
      expect(u.deleted_at).not.toBeNull();
      expect(u.deleted_by).toBe(target.id);

      // Dados por-usuário removidos.
      for (const q of [
        `SELECT count(*)::int AS c FROM core.user_permissions WHERE user_id = $1`,
        `SELECT count(*)::int AS c FROM core.sessions WHERE user_id = $1`,
        `SELECT count(*)::int AS c FROM core.notifications WHERE recipient_user_id = $1`,
      ]) {
        const { rows } = await client.query<{ c: number }>(q, [victim.id]);
        expect(rows[0]!.c).toBe(0);
      }
    });
  });

  it("reatribui trabalho ativo da categoria 1 ao destino", async () => {
    await withRollback(async (client) => {
      const victim = await makeUser(client);
      const target = await makeUser(client);
      const personId = await makePersonContact(client);

      // segment (created_by NOT NULL), project (owner NOT NULL + created_by),
      // project_comment (author NOT NULL), lead (assigned_to/created_by),
      // account_manager de um contato.
      const seg = await client.query<{ id: string }>(
        `INSERT INTO core.segments (name, criteria, created_by) VALUES ('S', '{}'::jsonb, $1) RETURNING id`,
        [victim.id],
      );
      const proj = await client.query<{ id: string }>(
        `INSERT INTO mod_projetos.projects (name, owner_user_id, created_by) VALUES ('P', $1, $1) RETURNING id`,
        [victim.id],
      );
      const comment = await client.query<{ id: string }>(
        `INSERT INTO mod_projetos.project_comments (project_id, author_user_id, body)
         VALUES ($1, $2, 'oi') RETURNING id`,
        [proj.rows[0]!.id, victim.id],
      );
      const lead = await client.query<{ id: string }>(
        `INSERT INTO mod_crm.leads (person_contact_id, assigned_to, created_by)
         VALUES ($1, $2, $2) RETURNING id`,
        [personId, victim.id],
      );
      const doc = `${Date.now()}${seq}`.slice(0, 14);
      const company = await client.query<{ id: string }>(
        `INSERT INTO core.contacts (contact_type, legal_name, fiscal_document, account_manager_user_id)
         VALUES ('empresa', 'Empresa', $1, $2) RETURNING id`,
        [doc, victim.id],
      );

      await deleteUser(client, victim.id, target.id, target.id);

      const segRow = await client.query(`SELECT created_by FROM core.segments WHERE id = $1`, [seg.rows[0]!.id]);
      expect(segRow.rows[0]!.created_by).toBe(target.id);
      const projRow = await client.query(
        `SELECT owner_user_id, created_by FROM mod_projetos.projects WHERE id = $1`,
        [proj.rows[0]!.id],
      );
      expect(projRow.rows[0]!.owner_user_id).toBe(target.id);
      expect(projRow.rows[0]!.created_by).toBe(target.id);
      const comRow = await client.query(
        `SELECT author_user_id FROM mod_projetos.project_comments WHERE id = $1`,
        [comment.rows[0]!.id],
      );
      expect(comRow.rows[0]!.author_user_id).toBe(target.id);
      const leadRow = await client.query(
        `SELECT assigned_to, created_by FROM mod_crm.leads WHERE id = $1`,
        [lead.rows[0]!.id],
      );
      expect(leadRow.rows[0]!.assigned_to).toBe(target.id);
      expect(leadRow.rows[0]!.created_by).toBe(target.id);
      const compRow = await client.query(
        `SELECT account_manager_user_id FROM core.contacts WHERE id = $1`,
        [company.rows[0]!.id],
      );
      expect(compRow.rows[0]!.account_manager_user_id).toBe(target.id);
    });
  });

  it("categoria 2: timeline/mensageria viram user_id NULL preservando o nome snapshot", async () => {
    await withRollback(async (client) => {
      const victim = await makeUser(client);
      const target = await makeUser(client);
      const personId = await makePersonContact(client);
      const lead = await client.query<{ id: string }>(
        `INSERT INTO mod_crm.leads (person_contact_id) VALUES ($1) RETURNING id`,
        [personId],
      );
      await client.query(
        `INSERT INTO mod_crm.lead_timeline (lead_id, user_id, user_name, action_type, text)
         VALUES ($1, $2, 'Nome Original', 'note', 'nota')`,
        [lead.rows[0]!.id, victim.id],
      );
      await client.query(
        `INSERT INTO mod_crm.messages (from_user_id, from_user_name, conversation_id, text)
         VALUES ($1, 'Autor Original', 'group', 'oi')`,
        [victim.id],
      );

      await deleteUser(client, victim.id, target.id, target.id);

      const tl = await client.query<{ user_id: string | null; user_name: string }>(
        `SELECT user_id, user_name FROM mod_crm.lead_timeline WHERE lead_id = $1`,
        [lead.rows[0]!.id],
      );
      expect(tl.rows[0]!.user_id).toBeNull();
      expect(tl.rows[0]!.user_name).toBe("Nome Original");

      const msg = await client.query<{ from_user_id: string | null; from_user_name: string }>(
        `SELECT from_user_id, from_user_name FROM mod_crm.messages WHERE conversation_id = 'group'`,
      );
      expect(msg.rows[0]!.from_user_id).toBeNull();
      expect(msg.rows[0]!.from_user_name).toBe("Autor Original");
    });
  });

  it("core.system_logs permanece intacto após excluir usuário com logs", async () => {
    await withRollback(async (client) => {
      const victim = await makeUser(client);
      const target = await makeUser(client);
      // Logs do próprio usuário excluído (ele agiu no sistema).
      await auditLog(client, { userId: victim.id, module: "core", action: "TESTE_ACAO_1" });
      await auditLog(client, { userId: victim.id, module: "core", action: "TESTE_ACAO_2" });

      const before = await client.query<{ id: string; action: string }>(
        `SELECT id, action FROM core.system_logs WHERE user_id = $1 ORDER BY action`,
        [victim.id],
      );
      expect(before.rows).toHaveLength(2);

      // Não deve lançar (nenhuma mutação em system_logs, direta ou por cascata).
      await deleteUser(client, victim.id, target.id, target.id);

      const after = await client.query<{ id: string; action: string }>(
        `SELECT id, action FROM core.system_logs WHERE user_id = $1 ORDER BY action`,
        [victim.id],
      );
      // Mesmas linhas, inalteradas (id/ação preservados).
      expect(after.rows).toEqual(before.rows);
    });
  });

  it("origem inexistente -> IAM_USER_NOT_FOUND", async () => {
    await withRollback(async (client) => {
      const target = await makeUser(client);
      await expect(
        deleteUser(client, "00000000-0000-0000-0000-000000000000", target.id, target.id),
      ).rejects.toMatchObject({ code: ErrorCode.IAM_USER_NOT_FOUND });
    });
  });

  it("origem já lápide -> IAM_USER_NOT_FOUND", async () => {
    await withRollback(async (client) => {
      const victim = await makeUser(client);
      const target = await makeUser(client);
      const other = await makeUser(client);
      await deleteUser(client, victim.id, target.id, target.id);
      await expect(
        deleteUser(client, victim.id, other.id, other.id),
      ).rejects.toMatchObject({ code: ErrorCode.IAM_USER_NOT_FOUND });
    });
  });

  it("destino inexistente -> IAM_REASSIGN_TARGET_NOT_FOUND, nada muda", async () => {
    await withRollback(async (client) => {
      const victim = await makeUser(client);
      const before = await getUserById(client, victim.id);
      await expect(
        deleteUser(client, victim.id, "00000000-0000-0000-0000-000000000000", null),
      ).rejects.toMatchObject({ code: ErrorCode.IAM_REASSIGN_TARGET_NOT_FOUND });
      expect(await getUserById(client, victim.id)).toEqual(before);
    });
  });

  it("destino = origem -> IAM_REASSIGN_TARGET_SAME", async () => {
    await withRollback(async (client) => {
      const victim = await makeUser(client);
      await expect(
        deleteUser(client, victim.id, victim.id, null),
      ).rejects.toMatchObject({ code: ErrorCode.IAM_REASSIGN_TARGET_SAME });
    });
  });

  it("destino inativo -> IAM_REASSIGN_TARGET_INACTIVE", async () => {
    await withRollback(async (client) => {
      const victim = await makeUser(client);
      const target = await makeUser(client, { status: "disabled" });
      await expect(
        deleteUser(client, victim.id, target.id, null),
      ).rejects.toMatchObject({ code: ErrorCode.IAM_REASSIGN_TARGET_INACTIVE });
    });
  });

  it("autoexclusão -> IAM_CANNOT_DELETE_SELF", async () => {
    await withRollback(async (client) => {
      const victim = await makeUser(client);
      const target = await makeUser(client);
      await expect(
        deleteUser(client, victim.id, target.id, victim.id),
      ).rejects.toMatchObject({ code: ErrorCode.IAM_CANNOT_DELETE_SELF });
    });
  });

  it("último superadmin ativo -> IAM_LAST_SUPERADMIN", async () => {
    await withRollback(async (client) => {
      // Zera os superadmins ativos pré-existentes para isolar o caso.
      await client.query(`UPDATE core.users SET status = 'disabled' WHERE role = 'superadmin'`);
      const victim = await makeUser(client, { role: "superadmin" });
      const target = await makeUser(client);
      await expect(
        deleteUser(client, victim.id, target.id, target.id),
      ).rejects.toMatchObject({ code: ErrorCode.IAM_LAST_SUPERADMIN });
    });
  });

  it("superadmin com outro superadmin ativo pode ser excluído", async () => {
    await withRollback(async (client) => {
      const victim = await makeUser(client, { role: "superadmin" });
      await makeUser(client, { role: "superadmin" }); // outro superadmin ativo
      const target = await makeUser(client);
      await deleteUser(client, victim.id, target.id, target.id);
      const u = await getUserById(client, victim.id);
      expect(u!.status).toBe("deleted");
    });
  });

  it("exatamente 1 auditoria IAM_USUARIO_EXCLUIDO com origem/destino/autor", async () => {
    await withRollback(async (client) => {
      const victim = await makeUser(client);
      const target = await makeUser(client);
      const actor = await makeUser(client);
      await deleteUser(client, victim.id, target.id, actor.id);
      const { rows } = await client.query<{
        user_id: string;
        payload_before: { id: string };
        payload_after: { reassigned_to: string };
      }>(
        `SELECT user_id, payload_before, payload_after FROM core.system_logs
         WHERE action = 'IAM_USUARIO_EXCLUIDO'`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.user_id).toBe(actor.id);
      expect(rows[0]!.payload_before.id).toBe(victim.id);
      expect(rows[0]!.payload_after.reassigned_to).toBe(target.id);
    });
  });

  it("em caso de erro, rollback total: sem auditoria IAM_USUARIO_EXCLUIDO remanescente", async () => {
    await withRollback(async (client) => {
      const victim = await makeUser(client);
      // destino inativo => erro APÓS as validações, mas a auditoria só é gravada
      // depois de todas as validações passarem; aqui garantimos que nenhuma
      // auditoria sobra quando a operação falha.
      const target = await makeUser(client, { status: "disabled" });
      await expect(
        deleteUser(client, victim.id, target.id, null),
      ).rejects.toBeInstanceOf(DomainError);
      const { rows } = await client.query<{ c: number }>(
        `SELECT count(*)::int AS c FROM core.system_logs WHERE action = 'IAM_USUARIO_EXCLUIDO'`,
      );
      expect(rows[0]!.c).toBe(0);
    });
  });

  it("lápide some de listUsers", async () => {
    await withRollback(async (client) => {
      const victim = await makeUser(client);
      const target = await makeUser(client);
      await deleteUser(client, victim.id, target.id, target.id);
      const list = await listUsers(client);
      expect(list.find((u) => u.id === victim.id)).toBeUndefined();
    });
  });
});

describe("DELETE /api/iam/users/:id (rota)", () => {
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
    const email = `delroute-${Math.random().toString(36).slice(2)}@example.com`;
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

  /** Insere um usuário comum (ativo) direto, sem login. */
  async function makePlainUser(): Promise<string> {
    const email = `delplain-${Math.random().toString(36).slice(2)}@example.com`;
    const { rows } = await getTestPool().query<{ id: string }>(
      `INSERT INTO core.users (email, full_name, password_set) VALUES ($1, 'P', true) RETURNING id`,
      [email],
    );
    return rows[0]!.id;
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

  it("DELETE com corpo JSON entrega request.body e exclui (204)", async () => {
    const auth = { authorization: `Bearer ${adminToken}` };
    const victim = await makePlainUser();
    const target = await makePlainUser();
    const res = await app.inject({
      method: "DELETE",
      url: `/api/iam/users/${victim}`,
      headers: auth,
      payload: { reassign_to_user_id: target },
    });
    expect(res.statusCode).toBe(204);
    const u = await withClient((c) => getUserById(c, victim));
    expect(u!.status).toBe("deleted");
  });

  it("origem inexistente -> 404", async () => {
    const auth = { authorization: `Bearer ${adminToken}` };
    const target = await makePlainUser();
    const res = await app.inject({
      method: "DELETE",
      url: `/api/iam/users/00000000-0000-0000-0000-000000000000`,
      headers: auth,
      payload: { reassign_to_user_id: target },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("IAM_USER_NOT_FOUND");
  });

  it("destino inexistente -> 404 IAM_REASSIGN_TARGET_NOT_FOUND", async () => {
    const auth = { authorization: `Bearer ${adminToken}` };
    const victim = await makePlainUser();
    const res = await app.inject({
      method: "DELETE",
      url: `/api/iam/users/${victim}`,
      headers: auth,
      payload: { reassign_to_user_id: "00000000-0000-0000-0000-000000000000" },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("IAM_REASSIGN_TARGET_NOT_FOUND");
  });

  it(":id malformado (não-UUID) -> 404, não 500", async () => {
    const auth = { authorization: `Bearer ${adminToken}` };
    const target = await makePlainUser();
    const res = await app.inject({
      method: "DELETE",
      url: `/api/iam/users/nao-e-uuid`,
      headers: auth,
      payload: { reassign_to_user_id: target },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("IAM_USER_NOT_FOUND");
  });

  it("reassign_to_user_id malformado -> 404, não 500", async () => {
    const auth = { authorization: `Bearer ${adminToken}` };
    const victim = await makePlainUser();
    const res = await app.inject({
      method: "DELETE",
      url: `/api/iam/users/${victim}`,
      headers: auth,
      payload: { reassign_to_user_id: "xyz" },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("IAM_REASSIGN_TARGET_NOT_FOUND");
  });

  it("autoexclusão -> 409", async () => {
    const auth = { authorization: `Bearer ${adminToken}` };
    const admin = await makeUserAndLogin(true);
    const target = await makePlainUser();
    const res = await app.inject({
      method: "DELETE",
      url: `/api/iam/users/${admin.id}`,
      headers: { authorization: `Bearer ${admin.token}` },
      payload: { reassign_to_user_id: target },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("IAM_CANNOT_DELETE_SELF");
    // sanity: outro admin não interfere
    void auth;
  });

  it("nega acesso sem a permissão (403)", async () => {
    const plain = await makeUserAndLogin(false);
    const victim = await makePlainUser();
    const target = await makePlainUser();
    const res = await app.inject({
      method: "DELETE",
      url: `/api/iam/users/${victim}`,
      headers: { authorization: `Bearer ${plain.token}` },
      payload: { reassign_to_user_id: target },
    });
    expect(res.statusCode).toBe(403);
  });
});
