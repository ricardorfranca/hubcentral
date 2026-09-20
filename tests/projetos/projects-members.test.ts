import { describe, it, expect, afterAll } from "vitest";
import type { PoolClient } from "pg";
import { withRollback, closeTestPool } from "../helpers/db.js";
import {
  createProject, updateProject, archiveProject, listProjectsForUser, getProject,
  assertProjectAccess, assertNotArchived,
} from "../../src/modules/projetos/project-service.js";
import { addMember, removeMember, listMembers, isParticipant } from "../../src/modules/projetos/member-service.js";

/**
 * @file projects-members.test.ts
 *
 * Testes da Fase 2: projetos (CRUD, arquivamento) e a regra de acesso
 * (não-participante não lista nem acessa), além da gestão de membros.
 */

afterAll(async () => {
  await closeTestPool();
});

let seq = 0;
async function newUser(client: PoolClient): Promise<string> {
  seq += 1;
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO core.users (email, full_name) VALUES ($1, $2) RETURNING id`,
    [`proj${seq}-${Math.random().toString(36).slice(2)}@x.com`, `User ${seq}`],
  );
  return rows[0]!.id;
}

describe("Projetos", () => {
  it("cria projeto, adiciona o dono como membro e retorna detalhe", async () => {
    await withRollback(async (client) => {
      const owner = await newUser(client);
      const p = await createProject(client, { name: "Projeto A", detail: "Descritivo rico" }, owner);
      expect(p.status).toBe("ativo");

      const view = await getProject(client, p.id, owner);
      expect(view.detail).toBe("Descritivo rico");
      expect(view.members.some((m) => m.user_id === owner)).toBe(true);
    });
  });

  it("listagem só retorna projetos do usuário (dono ou membro)", async () => {
    await withRollback(async (client) => {
      const owner = await newUser(client);
      const outro = await newUser(client);
      const p = await createProject(client, { name: "Meu" }, owner);

      // Owner vê; 'outro' não vê.
      expect((await listProjectsForUser(client, owner)).some((x) => x.id === p.id)).toBe(true);
      expect((await listProjectsForUser(client, outro)).some((x) => x.id === p.id)).toBe(false);
    });
  });

  it("nega acesso ao detalhe para não-participante", async () => {
    await withRollback(async (client) => {
      const owner = await newUser(client);
      const outro = await newUser(client);
      const p = await createProject(client, { name: "Privado" }, owner);

      await expect(getProject(client, p.id, outro)).rejects.toMatchObject({ code: "PROJ_ACCESS_DENIED" });
      await expect(assertProjectAccess(client, outro, p.id)).rejects.toMatchObject({ code: "PROJ_ACCESS_DENIED" });
    });
  });

  it("membro adicionado passa a ver e acessar o projeto", async () => {
    await withRollback(async (client) => {
      const owner = await newUser(client);
      const membro = await newUser(client);
      const p = await createProject(client, { name: "Compartilhado" }, owner);

      await addMember(client, p.id, membro, owner);
      expect((await listProjectsForUser(client, membro)).some((x) => x.id === p.id)).toBe(true);
      await expect(assertProjectAccess(client, membro, p.id)).resolves.toBeUndefined();
      expect(await isParticipant(client, p.id, membro)).toBe(true);
    });
  });

  it("arquiva projeto e bloqueia escrita via assertNotArchived", async () => {
    await withRollback(async (client) => {
      const owner = await newUser(client);
      const p = await createProject(client, { name: "P" }, owner);
      await archiveProject(client, p.id, owner);
      const view = await getProject(client, p.id, owner);
      expect(view.status).toBe("arquivado");
      await expect(assertNotArchived(client, p.id)).rejects.toMatchObject({ code: "PROJ_ARCHIVED" });
    });
  });

  it("editar projeto altera campos e mantém dono como membro ao trocar dono", async () => {
    await withRollback(async (client) => {
      const owner = await newUser(client);
      const novoDono = await newUser(client);
      const p = await createProject(client, { name: "Old" }, owner);

      const upd = await updateProject(client, p.id, { name: "New", ownerUserId: novoDono }, owner);
      expect(upd?.name).toBe("New");
      expect(upd?.owner_user_id).toBe(novoDono);
      expect((await listMembers(client, p.id)).some((m) => m.user_id === novoDono)).toBe(true);
    });
  });
});

describe("Membros", () => {
  it("remover membro remove suas atribuições, mantendo as tarefas", async () => {
    await withRollback(async (client) => {
      const owner = await newUser(client);
      const membro = await newUser(client);
      const p = await createProject(client, { name: "P" }, owner);
      await addMember(client, p.id, membro, owner);

      // cria tarefa e atribui ao membro (insert direto para isolar a Fase 2).
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO mod_projetos.tasks (project_id, title) VALUES ($1, 'T') RETURNING id`,
        [p.id],
      );
      const taskId = rows[0]!.id;
      await client.query(
        `INSERT INTO mod_projetos.task_assignees (task_id, user_id) VALUES ($1, $2)`,
        [taskId, membro],
      );

      await removeMember(client, p.id, membro, owner);

      const assignees = await client.query(`SELECT 1 FROM mod_projetos.task_assignees WHERE task_id = $1 AND user_id = $2`, [taskId, membro]);
      expect(assignees.rowCount).toBe(0);
      const task = await client.query(`SELECT 1 FROM mod_projetos.tasks WHERE id = $1`, [taskId]);
      expect(task.rowCount).toBe(1);
      expect(await isParticipant(client, p.id, membro)).toBe(false);
    });
  });
});
