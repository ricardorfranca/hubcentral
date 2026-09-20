/**
 * @file notifier.ts
 * @module modules/projetos
 *
 * Assinante do outbox que converte eventos do Módulo de Projetos em
 * notificações in-app. Assina `projetos.*` e, para cada evento, determina os
 * destinatários (sempre incluindo o Dono_Projeto e excluindo o autor da ação),
 * gravando notificações na Central de Notificações do núcleo.
 *
 * A entrega é idempotente por `source_event_id` (o `event_id` do envelope), de
 * modo que o reprocessamento do outbox não duplica notificações.
 */

import type { Pool, PoolClient } from "pg";
import { subscribe, type EventEnvelope } from "../../core/events/event-bus.js";
import { withTransaction } from "../../core/db/pool.js";
import { notify } from "../../core/notifications/notification-service.js";

/** Mensagem legível por tipo de evento. */
const MESSAGES: Record<string, string> = {
  "projetos.tarefa.movida": "Uma tarefa que você acompanha mudou de coluna.",
  "projetos.tarefa.atribuida": "Você foi atribuído a uma tarefa.",
  "projetos.comentario.criado": "Novo comentário em uma tarefa que você acompanha.",
  "projetos.projeto.comentado": "Novo comentário em um projeto do qual você participa.",
};

/** Retorna o `owner_user_id` de um projeto, ou `null`. */
async function projectOwner(client: PoolClient, projectId: string): Promise<string | null> {
  const { rows } = await client.query<{ owner_user_id: string }>(
    `SELECT owner_user_id FROM mod_projetos.projects WHERE id = $1`,
    [projectId],
  );
  return rows[0]?.owner_user_id ?? null;
}

/** Retorna os `user_id` atribuídos a uma tarefa. */
async function taskAssignees(client: PoolClient, taskId: string): Promise<string[]> {
  const { rows } = await client.query<{ user_id: string }>(
    `SELECT user_id FROM mod_projetos.task_assignees WHERE task_id = $1`,
    [taskId],
  );
  return rows.map((r) => r.user_id);
}

/** Retorna os `user_id` membros de um projeto. */
async function projectMembers(client: PoolClient, projectId: string): Promise<string[]> {
  const { rows } = await client.query<{ user_id: string }>(
    `SELECT user_id FROM mod_projetos.project_members WHERE project_id = $1`,
    [projectId],
  );
  return rows.map((r) => r.user_id);
}

/**
 * Calcula os destinatários de um evento (sem o autor).
 *
 * @param client - Cliente PostgreSQL.
 * @param envelope - Envelope do evento.
 * @returns Conjunto de `user_id` destinatários e metadados de navegação.
 */
async function resolveTargets(
  client: PoolClient,
  envelope: EventEnvelope,
): Promise<{ recipients: string[]; entityType: string; entityId: string; link: string }> {
  const p = envelope.payload as Record<string, string | null>;
  const actor = p.actor_user_id ?? null;
  const projectId = p.project_id ?? null;
  const set = new Set<string>();

  switch (envelope.event_name) {
    case "projetos.tarefa.movida":
    case "projetos.comentario.criado": {
      if (p.task_id) for (const u of await taskAssignees(client, p.task_id)) set.add(u);
      if (projectId) {
        const owner = await projectOwner(client, projectId);
        if (owner) set.add(owner);
      }
      const entityId = p.task_id ?? projectId ?? "";
      return {
        recipients: [...set].filter((u) => u !== actor),
        entityType: "task",
        entityId,
        link: projectId ? `/projetos/${projectId}/tarefas/${p.task_id ?? ""}` : "/projetos",
      };
    }
    case "projetos.tarefa.atribuida": {
      if (p.assignee_user_id) set.add(p.assignee_user_id);
      if (projectId) {
        const owner = await projectOwner(client, projectId);
        if (owner) set.add(owner);
      }
      return {
        recipients: [...set].filter((u) => u !== actor),
        entityType: "task",
        entityId: p.task_id ?? "",
        link: projectId ? `/projetos/${projectId}/tarefas/${p.task_id ?? ""}` : "/projetos",
      };
    }
    case "projetos.projeto.comentado": {
      if (projectId) {
        const owner = await projectOwner(client, projectId);
        if (owner) set.add(owner);
        for (const u of await projectMembers(client, projectId)) set.add(u);
      }
      return {
        recipients: [...set].filter((u) => u !== actor),
        entityType: "project",
        entityId: projectId ?? "",
        link: projectId ? `/projetos/${projectId}` : "/projetos",
      };
    }
    default:
      return { recipients: [], entityType: "", entityId: "", link: "/projetos" };
  }
}

/**
 * Processa um evento do módulo, criando as notificações correspondentes. Aberto
 * como função para permitir teste direto sem passar pelo despachante.
 *
 * @param pool - Pool de conexões.
 * @param envelope - Envelope do evento.
 */
export async function handleProjetosEvent(pool: Pool, envelope: EventEnvelope): Promise<void> {
  await withTransaction(pool, async (client) => {
    const { recipients, entityType, entityId, link } = await resolveTargets(client, envelope);
    const message = MESSAGES[envelope.event_name] ?? "Atualização em um projeto.";
    for (const recipient of recipients) {
      await notify(client, {
        recipientUserId: recipient,
        module: "projetos",
        type: envelope.event_name,
        message,
        entityType,
        entityId: entityId || undefined,
        link,
        sourceEventId: envelope.event_id,
      });
    }
  });
}

/**
 * Registra o assinante de `projetos.*` no barramento de eventos. Deve ser
 * chamado no bootstrap do servidor, junto ao worker do outbox.
 *
 * @param pool - Pool de conexões usado para gravar as notificações.
 */
export function registerProjetosNotifier(pool: Pool): void {
  subscribe("projetos.*", (envelope) => handleProjetosEvent(pool, envelope));
}
