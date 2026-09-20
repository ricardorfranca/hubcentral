/**
 * @file activity-service.ts
 * @module modules/crm
 *
 * Serviço de atividades (cadência de vendas): criar, concluir e listar
 * atividades vinculadas a conta/contato/oportunidade.
 */

import type { PoolClient } from "pg";

/** Tipo de atividade. */
export type ActivityType = "ligacao" | "email" | "reuniao" | "tarefa" | "nota";

/** Atividade persistida. */
export interface Activity {
  id: string;
  opportunity_id: string | null;
  account_id: string | null;
  person_contact_id: string | null;
  type: ActivityType;
  subject: string;
  notes: string | null;
  assigned_to: string | null;
  due_at: Date | null;
  status: "pendente" | "concluida";
  completed_at: Date | null;
}

const ACT_COLUMNS =
  "id, opportunity_id, account_id, person_contact_id, type, subject, notes, assigned_to, due_at, status, completed_at";

/**
 * Cria uma atividade.
 *
 * @param client - Cliente PostgreSQL.
 * @param input - Dados da atividade.
 * @param actorUserId - Autor.
 * @returns A atividade criada.
 */
export async function createActivity(
  client: PoolClient,
  input: {
    type: ActivityType;
    subject: string;
    notes?: string | undefined;
    opportunityId?: string | undefined;
    accountId?: string | undefined;
    personContactId?: string | undefined;
    assignedTo?: string | undefined;
    dueAt?: string | undefined;
  },
  actorUserId: string | null = null,
): Promise<Activity> {
  const { rows } = await client.query<Activity>(
    `INSERT INTO mod_crm.activities
       (opportunity_id, account_id, person_contact_id, type, subject, notes, assigned_to, due_at, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING ${ACT_COLUMNS}`,
    [
      input.opportunityId ?? null, input.accountId ?? null, input.personContactId ?? null,
      input.type, input.subject, input.notes ?? null,
      input.assignedTo ?? actorUserId, input.dueAt ?? null, actorUserId,
    ],
  );
  return rows[0] as Activity;
}

/**
 * Marca uma atividade como concluída.
 *
 * @param client - Cliente PostgreSQL.
 * @param id - `id` da atividade.
 * @returns A atividade atualizada, ou `null` se não existe.
 */
export async function completeActivity(client: PoolClient, id: string): Promise<Activity | null> {
  const { rows } = await client.query<Activity>(
    `UPDATE mod_crm.activities SET status = 'concluida', completed_at = now()
     WHERE id = $1 RETURNING ${ACT_COLUMNS}`,
    [id],
  );
  return rows[0] ?? null;
}

/**
 * Lista as atividades pendentes de um usuário, ordenadas por prazo.
 *
 * @param client - Cliente PostgreSQL.
 * @param userId - `user_id` do responsável.
 * @returns Atividades pendentes.
 */
export async function listMyActivities(client: PoolClient, userId: string): Promise<Activity[]> {
  const { rows } = await client.query<Activity>(
    `SELECT ${ACT_COLUMNS} FROM mod_crm.activities
     WHERE assigned_to = $1 AND status = 'pendente'
     ORDER BY due_at NULLS LAST, created_at`,
    [userId],
  );
  return rows;
}

/**
 * Lista as atividades de uma oportunidade (todas), mais recentes primeiro.
 *
 * @param client - Cliente PostgreSQL.
 * @param opportunityId - `id` da oportunidade.
 * @returns Atividades da oportunidade.
 */
export async function listByOpportunity(client: PoolClient, opportunityId: string): Promise<Activity[]> {
  const { rows } = await client.query<Activity>(
    `SELECT ${ACT_COLUMNS} FROM mod_crm.activities
     WHERE opportunity_id = $1 ORDER BY created_at DESC`,
    [opportunityId],
  );
  return rows;
}
