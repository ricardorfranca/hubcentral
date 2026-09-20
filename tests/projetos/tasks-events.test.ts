import { describe, it, expect, afterAll } from "vitest";
import type { Pool, PoolClient } from "pg";
import { getTestPool, withRollback, closeTestPool } from "../helpers/db.js";
import { buildEnvelope, type EventEnvelope } from "../../src/core/events/event-bus.js";
import { createProject, getProjectTotals } from "../../src/modules/projetos/project-service.js";
import { addMember } from "../../src/modules/projetos/member-service.js";
import { createTask, moveTask, listTasksByProject } from "../../src/modules/projetos/task-service.js";
import { setAssignee } from "../../src/modules/projetos/assignment-service.js";
import { addTaskComment, addProjectComment, listTaskComments } from "../../src/modules/projetos/comment-service.js";
import { handleProjetosEvent } from "../../src/modules/projetos/notifier.js";

/**
 * @file tasks-events.test.ts
 *
 * Testes de Projetos 2.0: Kanban (criar/mover), dependências, prazos, tempo,
 * atribuição única, comentários, eventos no outbox e o notifier.
 */

afterAll(async () => {
  await closeTestPool();
});

let seq = 0;
async function newUser(client: PoolClient): Promise<string> {
  seq += 1;
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO core.users (email, full_name) VALUES ($1, $2) RETURNING id`,
    [`te${seq}-${Math.random().toString(36).slice(2)}@x.com`, `U${seq}`],
  );
  return rows[0]!.id;
}

async function outboxNames(client: PoolClient): Promise<string[]> {
  const { rows } = await client.query<{ event_name: string }>(
    `SELECT event_name FROM core.event_outbox ORDER BY created_at`,
  );
  return rows.map((r) => r.event_name);
}

describe("Kanban de tarefas", () => {
  it("cria tarefa, move entre colunas (evento + anotação automática)", async () => {
    await withRollback(async (client) => {
      const owner = await newUser(client);
      const p = await createProject(client, { name: "P" }, owner);

      const t = await createTask(client, { projectId: p.id, title: "Fazer X" }, owner);
      expect(t.status).toBe("nao_iniciada");

      const moved = await moveTask(client, t.id, "em_execucao", undefined, owner);
      expect(moved.status).toBe("em_execucao");

      const board = await listTasksByProject(client, p.id, owner);
      expect(board.find((x) => x.id === t.id)?.status).toBe("em_execucao");

      // Anotação automática registrada.
      const comments = await listTaskComments(client, t.id);
      expect(comments.some((c) => c.body.includes("moveu a tarefa"))).toBe(true);

      expect(await outboxNames(client)).toContain("projetos.tarefa.movida");
    });
  });

  it("bloqueia criação de tarefa em projeto arquivado", async () => {
    await withRollback(async (client) => {
      const owner = await newUser(client);
      const p = await createProject(client, { name: "P" }, owner);
      await client.query(`UPDATE mod_projetos.projects SET status = 'arquivado' WHERE id = $1`, [p.id]);
      await expect(createTask(client, { projectId: p.id, title: "X" }, owner)).rejects.toMatchObject({ code: "PROJ_ARCHIVED" });
    });
  });

  it("valida prazo da tarefa dentro do prazo do projeto", async () => {
    await withRollback(async (client) => {
      const owner = await newUser(client);
      const p = await createProject(client, { name: "P", dueDate: "2026-06-30" }, owner);
      await expect(
        createTask(client, { projectId: p.id, title: "T", dueDate: "2026-07-15" }, owner),
      ).rejects.toMatchObject({ code: "PROJ_TASK_DUE_AFTER_PROJECT" });
      // Dentro do prazo é aceito.
      const ok = await createTask(client, { projectId: p.id, title: "T2", dueDate: "2026-06-15" }, owner);
      expect(ok.due_date).not.toBeNull();
    });
  });
});

describe("Dependências", () => {
  it("bloqueia iniciar tarefa cuja dependência não está finalizada", async () => {
    await withRollback(async (client) => {
      const owner = await newUser(client);
      const p = await createProject(client, { name: "P" }, owner);
      const a = await createTask(client, { projectId: p.id, title: "A" }, owner);
      const b = await createTask(client, { projectId: p.id, title: "B", dependsOnTaskId: a.id }, owner);

      // A não está finalizada: mover B para em_execucao deve falhar.
      await expect(moveTask(client, b.id, "em_execucao", undefined, owner)).rejects.toMatchObject({ code: "PROJ_DEPENDENCY_NOT_DONE" });

      // Finaliza A; agora B pode iniciar.
      await moveTask(client, a.id, "finalizada", undefined, owner);
      const moved = await moveTask(client, b.id, "em_execucao", undefined, owner);
      expect(moved.status).toBe("em_execucao");
    });
  });
});

describe("Atribuição única", () => {
  it("define responsável participante e publica evento; nega não-participante", async () => {
    await withRollback(async (client) => {
      const owner = await newUser(client);
      const membro = await newUser(client);
      const estranho = await newUser(client);
      const p = await createProject(client, { name: "P" }, owner);
      await addMember(client, p.id, membro, owner);
      const t = await createTask(client, { projectId: p.id, title: "T" }, owner);

      await setAssignee(client, t.id, membro, owner);
      expect(await outboxNames(client)).toContain("projetos.tarefa.atribuida");

      await expect(setAssignee(client, t.id, estranho, owner)).rejects.toMatchObject({ code: "PROJ_ACCESS_DENIED" });

      await setAssignee(client, t.id, null, owner);
      const board = await listTasksByProject(client, p.id, owner);
      expect(board.find((x) => x.id === t.id)?.assignee_user_id).toBeNull();
    });
  });
});

describe("Visibilidade de tarefa", () => {
  it("tarefa restrita só aparece para dono e responsável", async () => {
    await withRollback(async (client) => {
      const owner = await newUser(client);
      const membro = await newUser(client);
      const p = await createProject(client, { name: "P" }, owner);
      await addMember(client, p.id, membro, owner);
      const t = await createTask(client, { projectId: p.id, title: "Secreta", visibleToAll: false }, owner);

      // Owner vê; membro (não responsável) não vê.
      expect((await listTasksByProject(client, p.id, owner)).some((x) => x.id === t.id)).toBe(true);
      expect((await listTasksByProject(client, p.id, membro)).some((x) => x.id === t.id)).toBe(false);

      // Ao atribuir o membro, ele passa a ver.
      await setAssignee(client, t.id, membro, owner);
      expect((await listTasksByProject(client, p.id, membro)).some((x) => x.id === t.id)).toBe(true);
    });
  });
});

describe("Tempo e custos", () => {
  it("soma minutos dos comentários no card e no total do projeto", async () => {
    await withRollback(async (client) => {
      const owner = await newUser(client);
      const p = await createProject(client, { name: "P", hourlyRate: 120 }, owner);
      const t = await createTask(client, { projectId: p.id, title: "T" }, owner);

      await addTaskComment(client, t.id, owner, "trabalho 1", 30);
      await addTaskComment(client, t.id, owner, "trabalho 2", 90);

      const board = await listTasksByProject(client, p.id, owner);
      expect(board.find((x) => x.id === t.id)?.minutes_total).toBe(120);

      const totals = await getProjectTotals(client, p.id);
      expect(totals.total_minutes).toBe(120);
      // 120 min = 2h × R$120 = R$240 de mão de obra.
      expect(totals.labor_cost).toBe(240);
    });
  });
});

describe("Comentários", () => {
  it("comenta em tarefa e em projeto, publicando os eventos", async () => {
    await withRollback(async (client) => {
      const owner = await newUser(client);
      const p = await createProject(client, { name: "P" }, owner);
      const t = await createTask(client, { projectId: p.id, title: "T" }, owner);

      await addTaskComment(client, t.id, owner, "primeiro");
      await addProjectComment(client, p.id, owner, "sobre o projeto");

      const comments = await listTaskComments(client, t.id);
      expect(comments.some((c) => c.body === "primeiro")).toBe(true);

      const names = await outboxNames(client);
      expect(names).toContain("projetos.comentario.criado");
      expect(names).toContain("projetos.projeto.comentado");
    });
  });
});

describe("Notifier (evento -> notificações)", () => {
  it("tarefa.movida notifica responsável + dono, exceto o autor; dedupe por event_id", async () => {
    const pool: Pool = getTestPool();
    const ids: { owner?: string; membro?: string; project?: string } = {};
    try {
      const owner = await oneId(pool, `INSERT INTO core.users (email, full_name) VALUES ($1,'O') RETURNING id`, [`nowner-${rand()}@x.com`]);
      const membro = await oneId(pool, `INSERT INTO core.users (email, full_name) VALUES ($1,'M') RETURNING id`, [`nmembro-${rand()}@x.com`]);
      ids.owner = owner; ids.membro = membro;
      const project = await oneId(pool, `INSERT INTO mod_projetos.projects (name, owner_user_id) VALUES ('P',$1) RETURNING id`, [owner]);
      ids.project = project;
      await pool.query(`INSERT INTO mod_projetos.project_members (project_id, user_id) VALUES ($1,$2),($1,$3)`, [project, owner, membro]);
      // Responsável único = membro.
      const task = await oneId(pool, `INSERT INTO mod_projetos.tasks (project_id, title, assignee_user_id) VALUES ($1,'T',$2) RETURNING id`, [project, membro]);

      const env: EventEnvelope = buildEnvelope("projetos.tarefa.movida", "mod_projetos", {
        task_id: task, project_id: project, from: "nao_iniciada", to: "em_execucao", actor_user_id: membro,
      });
      await handleProjetosEvent(pool, env);
      await handleProjetosEvent(pool, env); // reprocesso (dedupe)

      const ownerNotifs = await count(pool, `SELECT count(*)::int AS n FROM core.notifications WHERE recipient_user_id=$1 AND source_event_id=$2`, [owner, env.event_id]);
      const membroNotifs = await count(pool, `SELECT count(*)::int AS n FROM core.notifications WHERE recipient_user_id=$1 AND source_event_id=$2`, [membro, env.event_id]);
      expect(ownerNotifs).toBe(1);
      expect(membroNotifs).toBe(0);
    } finally {
      if (ids.project) await pool.query(`DELETE FROM mod_projetos.projects WHERE id=$1`, [ids.project]);
      if (ids.owner) await pool.query(`DELETE FROM core.notifications WHERE recipient_user_id=$1`, [ids.owner]);
      if (ids.membro) await pool.query(`DELETE FROM core.notifications WHERE recipient_user_id=$1`, [ids.membro]);
      if (ids.owner) await pool.query(`DELETE FROM core.users WHERE id=$1`, [ids.owner]);
      if (ids.membro) await pool.query(`DELETE FROM core.users WHERE id=$1`, [ids.membro]);
    }
  });
});

function rand(): string {
  return Math.random().toString(36).slice(2);
}
async function oneId(pool: Pool, sql: string, params: unknown[]): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(sql, params as unknown[]);
  return rows[0]!.id;
}
async function count(pool: Pool, sql: string, params: unknown[]): Promise<number> {
  const { rows } = await pool.query<{ n: number }>(sql, params as unknown[]);
  return rows[0]!.n;
}
