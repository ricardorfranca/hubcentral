import { describe, it, expect, afterAll } from "vitest";
import type { PoolClient } from "pg";
import { withRollback, closeTestPool } from "../helpers/db.js";
import { scanDeadlinesWithClient } from "../../src/core/notifications/deadline-service.js";
import { listForUser } from "../../src/core/notifications/notification-service.js";
import { deterministicUuid } from "../../src/core/notifications/deterministic-id.js";

/**
 * @file deadline-service.test.ts
 *
 * Testes da varredura de prazos: gera alertas no sino para tarefas de projeto e
 * atividades de CRM vencidas ou a vencer, e é idempotente entre ciclos.
 */

afterAll(async () => {
  await closeTestPool();
});

let seq = 0;
async function newUser(client: PoolClient): Promise<string> {
  seq += 1;
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO core.users (email, full_name) VALUES ($1, 'U') RETURNING id`,
    [`deadline${seq}-${Math.random().toString(36).slice(2)}@x.com`],
  );
  return rows[0]!.id;
}

describe("Varredura de prazos", () => {
  it("gera alerta 'vencido' para tarefa de projeto atrasada e é idempotente", async () => {
    await withRollback(async (client) => {
      const owner = await newUser(client);
      const { rows: pr } = await client.query<{ id: string }>(
        `INSERT INTO mod_projetos.projects (name, owner_user_id, warn_days)
         VALUES ('Proj', $1, 2) RETURNING id`,
        [owner],
      );
      const projectId = pr[0]!.id;
      const { rows: tr } = await client.query<{ id: string }>(
        `INSERT INTO mod_projetos.tasks (project_id, title, status, due_date, assignee_user_id)
         VALUES ($1, 'Tarefa atrasada', 'em_execucao', CURRENT_DATE - 3, $2) RETURNING id`,
        [projectId, owner],
      );
      const taskId = tr[0]!.id;

      const created = await scanDeadlinesWithClient(client);
      expect(created).toBeGreaterThanOrEqual(1);

      const list = await listForUser(client, owner);
      const alert = list.find((n) => n.entity_id === taskId);
      expect(alert).toBeDefined();
      expect(alert!.type).toBe("projetos.tarefa.prazo.overdue");
      expect(alert!.link).toBe(`/projetos/${projectId}/tarefas/${taskId}`);

      // Segundo ciclo não cria duplicata (dedupe por source_event_id determinístico).
      const again = await scanDeadlinesWithClient(client);
      const afterList = await listForUser(client, owner);
      expect(afterList.filter((n) => n.entity_id === taskId)).toHaveLength(1);
      expect(again).toBe(0);
    });
  });

  it("gera alerta 'a vencer' para atividade de CRM dentro da janela", async () => {
    await withRollback(async (client) => {
      const user = await newUser(client);
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO mod_crm.activities (type, subject, assigned_to, due_at, status)
         VALUES ('tarefa', 'Ligar para cliente', $1, now() + interval '1 day', 'pendente')
         RETURNING id`,
        [user],
      );
      const activityId = rows[0]!.id;

      await scanDeadlinesWithClient(client);

      const list = await listForUser(client, user);
      const alert = list.find((n) => n.entity_id === activityId);
      expect(alert).toBeDefined();
      expect(alert!.type).toBe("crm.atividade.prazo.warning");
    });
  });

  it("não alerta tarefa finalizada nem tarefa fora da janela", async () => {
    await withRollback(async (client) => {
      const owner = await newUser(client);
      const { rows: pr } = await client.query<{ id: string }>(
        `INSERT INTO mod_projetos.projects (name, owner_user_id, warn_days)
         VALUES ('Proj2', $1, 2) RETURNING id`,
        [owner],
      );
      const projectId = pr[0]!.id;
      // Finalizada e vencida: não deve alertar.
      await client.query(
        `INSERT INTO mod_projetos.tasks (project_id, title, status, due_date, assignee_user_id)
         VALUES ($1, 'Feita', 'finalizada', CURRENT_DATE - 5, $2)`,
        [projectId, owner],
      );
      // Prazo distante (fora da janela de 2 dias): não deve alertar.
      await client.query(
        `INSERT INTO mod_projetos.tasks (project_id, title, status, due_date, assignee_user_id)
         VALUES ($1, 'Longe', 'em_execucao', CURRENT_DATE + 30, $2)`,
        [projectId, owner],
      );

      await scanDeadlinesWithClient(client);
      const list = await listForUser(client, owner);
      // Apenas o alerta do próprio projeto (não das tarefas) pode aparecer se o
      // projeto tivesse prazo; aqui o projeto não tem due_date, então nada.
      expect(list.filter((n) => n.entity_type === "task")).toHaveLength(0);
    });
  });

  it("DEADLINE_CRM_WARN_DAYS amplia a janela de 'a vencer' do CRM", async () => {
    const prev = process.env.DEADLINE_CRM_WARN_DAYS;
    try {
      await withRollback(async (client) => {
        const user = await newUser(client);
        // Vence em 5 dias: fora da janela padrão (2), dentro se a janela for 10.
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO mod_crm.activities (type, subject, assigned_to, due_at, status)
           VALUES ('tarefa', 'Follow-up', $1, now() + interval '5 days', 'pendente')
           RETURNING id`,
          [user],
        );
        const activityId = rows[0]!.id;

        // Com o default (2), não alerta.
        process.env.DEADLINE_CRM_WARN_DAYS = "2";
        await scanDeadlinesWithClient(client);
        let list = await listForUser(client, user);
        expect(list.find((n) => n.entity_id === activityId)).toBeUndefined();

        // Ampliando para 10, passa a alertar (a vencer).
        process.env.DEADLINE_CRM_WARN_DAYS = "10";
        await scanDeadlinesWithClient(client);
        list = await listForUser(client, user);
        const alert = list.find((n) => n.entity_id === activityId);
        expect(alert).toBeDefined();
        expect(alert!.type).toBe("crm.atividade.prazo.warning");
      });
    } finally {
      if (prev === undefined) delete process.env.DEADLINE_CRM_WARN_DAYS;
      else process.env.DEADLINE_CRM_WARN_DAYS = prev;
    }
  });

  it("deterministicUuid é estável e no formato UUID v5", async () => {
    const a = deterministicUuid("deadline:task:abc:overdue:2026-09-22");
    const b = deterministicUuid("deadline:task:abc:overdue:2026-09-22");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    // Chave diferente ⇒ UUID diferente.
    expect(deterministicUuid("deadline:task:abc:warning:2026-09-22")).not.toBe(a);
  });
});
