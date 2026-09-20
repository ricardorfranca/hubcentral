import { describe, it, expect, afterAll } from "vitest";
import type { Pool, PoolClient } from "pg";
import { getTestPool, withRollback, closeTestPool } from "../helpers/db.js";
import { buildEnvelope, type EventEnvelope } from "../../src/core/events/event-bus.js";
import { createProject } from "../../src/modules/projetos/project-service.js";
import { addMember } from "../../src/modules/projetos/member-service.js";
import { createTask, moveTask, listTasksByProject } from "../../src/modules/projetos/task-service.js";
import { assign, unassign, listAssignees } from "../../src/modules/projetos/assignment-service.js";
import { addTaskComment, addProjectComment, listTaskComments } from "../../src/modules/projetos/comment-service.js";
import { handleProjetosEvent } from "../../src/modules/projetos/notifier.js";

/**
 * @file tasks-events.test.ts
 *
 * Testes da Fase 3: Kanban (criar/mover), atribuição, comentários (eventos no
 * outbox) e o notifier (evento -> notificações para os destinatários certos).
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

/** Lê os event_names pendentes no outbox (dentro da transação de teste). */
async function outboxNames(client: PoolClient): Promise<string[]> {
  const { rows } = await client.query<{ event_name: string }>(
    `SELECT event_name FROM core.event_outbox ORDER BY created_at`,
  );
  return rows.map((r) => r.event_name);
}

describe("Kanban de tarefas", () => {
  it("cria tarefa na primeira coluna e move entre colunas (publica evento)", async () => {
    await withRollback(async (client) => {
      const owner = await newUser(client);
      const p = await createProject(client, { name: "P" }, owner);

      const t = await createTask(client, { projectId: p.id, title: "Fazer X" }, owner);
      expect(t.status).toBe("nao_iniciada");

      const moved = await moveTask(client, t.id, "em_execucao", undefined, owner);
      expect(moved.status).toBe("em_execucao");

      const board = await listTasksByProject(client, p.id);
      expect(board.find((x) => x.id === t.id)?.status).toBe("em_execucao");

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
});

describe("Atribuição", () => {
  it("atribui a participante e publica evento; nega não-participante", async () => {
    await withRollback(async (client) => {
      const owner = await newUser(client);
      const membro = await newUser(client);
      const estranho = await newUser(client);
      const p = await createProject(client, { name: "P" }, owner);
      await addMember(client, p.id, membro, owner);
      const t = await createTask(client, { projectId: p.id, title: "T" }, owner);

      await assign(client, t.id, membro, owner);
      expect(await listAssignees(client, t.id)).toContain(membro);
      expect(await outboxNames(client)).toContain("projetos.tarefa.atribuida");

      await expect(assign(client, t.id, estranho, owner)).rejects.toMatchObject({ code: "PROJ_ACCESS_DENIED" });

      await unassign(client, t.id, membro, owner);
      expect(await listAssignees(client, t.id)).not.toContain(membro);
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
      expect(comments).toHaveLength(1);
      expect(comments[0]!.body).toBe("primeiro");

      const names = await outboxNames(client);
      expect(names).toContain("projetos.comentario.criado");
      expect(names).toContain("projetos.projeto.comentado");
    });
  });
});

describe("Notifier (evento -> notificações)", () => {
  // Usa dados COMMITADOS porque o handler abre a própria transação.
  it("tarefa.movida notifica atribuídos + dono, exceto o autor; dedupe por event_id", async () => {
    const pool: Pool = getTestPool();
    const ids: { owner?: string; membro?: string; project?: string; task?: string } = {};
    try {
      // Setup commitado.
      const owner = await oneId(pool, `INSERT INTO core.users (email, full_name) VALUES ($1,'O') RETURNING id`, [`nowner-${rand()}@x.com`]);
      const membro = await oneId(pool, `INSERT INTO core.users (email, full_name) VALUES ($1,'M') RETURNING id`, [`nmembro-${rand()}@x.com`]);
      ids.owner = owner; ids.membro = membro;
      const project = await oneId(pool, `INSERT INTO mod_projetos.projects (name, owner_user_id) VALUES ('P',$1) RETURNING id`, [owner]);
      ids.project = project;
      await pool.query(`INSERT INTO mod_projetos.project_members (project_id, user_id) VALUES ($1,$2),($1,$3)`, [project, owner, membro]);
      const task = await oneId(pool, `INSERT INTO mod_projetos.tasks (project_id, title) VALUES ($1,'T') RETURNING id`, [project]);
      ids.task = task;
      await pool.query(`INSERT INTO mod_projetos.task_assignees (task_id, user_id) VALUES ($1,$2)`, [task, membro]);

      // Evento movido pelo próprio membro -> destinatário deve ser só o dono.
      const env: EventEnvelope = buildEnvelope("projetos.tarefa.movida", "mod_projetos", {
        task_id: task, project_id: project, from: "nao_iniciada", to: "em_execucao", actor_user_id: membro,
      });
      await handleProjetosEvent(pool, env);
      // Reprocessa o MESMO evento (dedupe).
      await handleProjetosEvent(pool, env);

      const ownerNotifs = await count(pool, `SELECT count(*)::int AS n FROM core.notifications WHERE recipient_user_id=$1 AND source_event_id=$2`, [owner, env.event_id]);
      const membroNotifs = await count(pool, `SELECT count(*)::int AS n FROM core.notifications WHERE recipient_user_id=$1 AND source_event_id=$2`, [membro, env.event_id]);
      expect(ownerNotifs).toBe(1);   // dono recebe (uma vez, apesar do reprocesso)
      expect(membroNotifs).toBe(0);  // autor não recebe
    } finally {
      // Limpeza (ordem por FK). CASCADE cuida de tasks/members/notifications de projeto.
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
