import { describe, it, expect, afterAll, beforeAll } from "vitest";
import type { FastifyInstance } from "fastify";
import type { PoolClient } from "pg";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { getTestPool, closeTestPool } from "../helpers/db.js";
import { buildApp } from "../../src/http/app.js";
import { setPassword } from "../../src/core/iam/identity-service.js";
import { grantNamespace } from "../../src/core/iam/rbac.js";
import { PROJETOS_NAMESPACES } from "../../src/core/iam/namespaces.js";

/**
 * @file projetos-api.test.ts
 *
 * Testes de rota do Módulo de Projetos: RBAC (nega sem namespace), regra de
 * participação (nega projeto alheio), fluxo de tarefas e anexos (upload/download/
 * validação).
 */

let app: FastifyInstance;
let uploadsDir: string;

async function withClient<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await getTestPool().connect();
  try {
    return await fn(c);
  } finally {
    c.release();
  }
}

/** Cria usuário com senha e (opcionalmente) todos os namespaces de projetos. */
async function makeUser(withProjNs: boolean): Promise<{ id: string; token: string }> {
  const email = `pj-${Math.random().toString(36).slice(2)}@x.com`;
  const { rows } = await getTestPool().query<{ id: string }>(
    `INSERT INTO core.users (email, full_name, password_set) VALUES ($1, 'U', true) RETURNING id`,
    [email],
  );
  const id = rows[0]!.id;
  await withClient((c) => setPassword(c, id, "senha123"));
  if (withProjNs) {
    await withClient(async (c) => {
      for (const ns of PROJETOS_NAMESPACES) await grantNamespace(c, id, ns);
    });
  }
  const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: "senha123" } });
  return { id, token: res.json().token };
}

function auth(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

beforeAll(async () => {
  // Uploads em diretório temporário isolado.
  uploadsDir = await fs.mkdtemp(path.join(os.tmpdir(), "hub-uploads-"));
  process.env.UPLOADS_DIR = uploadsDir;
  app = buildApp(getTestPool());
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await fs.rm(uploadsDir, { recursive: true, force: true });
  await closeTestPool();
});

describe("Projetos — RBAC e acesso", () => {
  it("nega criação de projeto sem o namespace (403)", async () => {
    const plain = await makeUser(false);
    const res = await app.inject({ method: "POST", url: "/api/projetos", headers: auth(plain.token), payload: { name: "X" } });
    expect(res.statusCode).toBe(403);
  });

  it("dono cria e vê o projeto; não-participante recebe 403 no detalhe", async () => {
    const owner = await makeUser(true);
    const outro = await makeUser(true);

    const created = await app.inject({ method: "POST", url: "/api/projetos", headers: auth(owner.token), payload: { name: "Privado", detail: "rico" } });
    expect(created.statusCode).toBe(201);
    const projectId = created.json().id;

    // Dono acessa.
    const ownerGet = await app.inject({ method: "GET", url: `/api/projetos/${projectId}`, headers: auth(owner.token) });
    expect(ownerGet.statusCode).toBe(200);
    expect(ownerGet.json().detail).toBe("rico");

    // Não-participante (com namespace) é barrado pela regra de participação.
    const outroGet = await app.inject({ method: "GET", url: `/api/projetos/${projectId}`, headers: auth(outro.token) });
    expect(outroGet.statusCode).toBe(403);
    expect(outroGet.json().code).toBe("PROJ_ACCESS_DENIED");

    // Listagem do não-participante não inclui o projeto.
    const outroList = await app.inject({ method: "GET", url: "/api/projetos", headers: auth(outro.token) });
    expect((outroList.json() as { id: string }[]).some((p) => p.id === projectId)).toBe(false);
  });
});

describe("Projetos — tarefas, membros e anexos", () => {
  it("fluxo completo: membro, tarefa, mover, comentar e anexo (upload/download/validação)", async () => {
    const owner = await makeUser(true);
    const membro = await makeUser(true);

    const created = await app.inject({ method: "POST", url: "/api/projetos", headers: auth(owner.token), payload: { name: "P" } });
    const projectId = created.json().id;

    // Adiciona membro.
    const addMember = await app.inject({ method: "POST", url: `/api/projetos/${projectId}/members`, headers: auth(owner.token), payload: { user_id: membro.id } });
    expect(addMember.statusCode).toBe(204);

    // Membro cria tarefa.
    const task = await app.inject({ method: "POST", url: `/api/projetos/${projectId}/tasks`, headers: auth(membro.token), payload: { title: "Fazer" } });
    expect(task.statusCode).toBe(201);
    const taskId = task.json().id;

    // Move para em_execucao.
    const moved = await app.inject({ method: "PATCH", url: `/api/projetos/tasks/${taskId}/move`, headers: auth(membro.token), payload: { status: "em_execucao" } });
    expect(moved.statusCode).toBe(200);
    expect(moved.json().status).toBe("em_execucao");

    // Comenta.
    const comment = await app.inject({ method: "POST", url: `/api/projetos/tasks/${taskId}/comments`, headers: auth(membro.token), payload: { body: "andamento" } });
    expect(comment.statusCode).toBe(201);

    // Upload de anexo válido (txt).
    const upload = await uploadFile(taskId, membro.token, "nota.txt", "text/plain", Buffer.from("conteudo"));
    expect(upload.statusCode).toBe(201);
    const attId = upload.json().id;

    // Download retorna o conteúdo original.
    const download = await app.inject({ method: "GET", url: `/api/projetos/attachments/${attId}`, headers: auth(membro.token) });
    expect(download.statusCode).toBe(200);
    expect(download.body).toBe("conteudo");

    // Anexo com extensão não permitida (exe) é rejeitado.
    const bad = await uploadFile(taskId, membro.token, "malware.exe", "application/octet-stream", Buffer.from("x"));
    expect(bad.statusCode).toBe(400);
    expect(bad.json().code).toBe("PROJ_ATTACHMENT_INVALID");

    // Exclui o anexo válido.
    const del = await app.inject({ method: "DELETE", url: `/api/projetos/attachments/${attId}`, headers: auth(membro.token) });
    expect(del.statusCode).toBe(204);
  });
});

/** Monta um POST multipart de arquivo para a rota de anexos. */
async function uploadFile(
  taskId: string,
  token: string,
  filename: string,
  contentType: string,
  content: Buffer,
): Promise<Awaited<ReturnType<FastifyInstance["inject"]>>> {
  const boundary = "----vitestboundary" + Math.random().toString(36).slice(2);
  const head = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`;
  const tail = `\r\n--${boundary}--\r\n`;
  const payload = Buffer.concat([Buffer.from(head), content, Buffer.from(tail)]);
  return app.inject({
    method: "POST",
    url: `/api/projetos/tasks/${taskId}/attachments`,
    headers: { ...auth(token), "content-type": `multipart/form-data; boundary=${boundary}` },
    payload,
  });
}
