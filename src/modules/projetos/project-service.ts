/**
 * @file project-service.ts
 * @module modules/projetos
 *
 * Serviço de Projetos Internos. Um projeto tem dono e membros (referências a
 * core.users), descritivo principal, e status ativo/arquivado. O acesso é
 * restrito a dono ou membro — a listagem só retorna os projetos do usuário e o
 * detalhe é negado a não-participantes.
 */

import type { PoolClient } from "pg";
import { DomainError, ErrorCode } from "../../core/errors.js";
import { log as auditLog } from "../../core/audit/audit-logger.js";

/** Projeto como persistido em `mod_projetos.projects`. */
export interface Project {
  id: string;
  name: string;
  description: string | null;
  detail: string | null;
  owner_user_id: string;
  status: "ativo" | "arquivado";
  due_date: string | null;
  hourly_rate: string;
  warn_days: number;
  created_at: Date;
  updated_at: Date;
}

/** Totais agregados do projeto (tempo e custos). */
export interface ProjectTotals {
  /** Minutos apontados em todos os comentários de tarefas do projeto. */
  total_minutes: number;
  /** Custo estimado das horas (minutos/60 × valor/hora do projeto). */
  labor_cost: number;
  /** Soma dos custos de recursos diversos. */
  resource_cost: number;
  /** Custo total (labor + recursos). */
  total_cost: number;
}

/** Projeto com membros, comentários, recursos e totais resolvidos. */
export interface ProjectView extends Project {
  members: { user_id: string; full_name: string | null; email: string }[];
  comments: { id: string; author_user_id: string; author_name: string | null; body: string; created_at: Date }[];
  resources: { id: string; description: string; cost: string; created_at: Date }[];
  totals: ProjectTotals;
}

const COLUMNS =
  "id, name, description, detail, owner_user_id, status, due_date, hourly_rate, warn_days, created_at, updated_at";

/**
 * Verifica se o usuário é dono ou membro do projeto; lança se não for.
 *
 * @param client - Cliente PostgreSQL.
 * @param userId - `user_id` autenticado.
 * @param projectId - `id` do projeto.
 * @throws {DomainError} `PROJ_NOT_FOUND` se o projeto não existe.
 * @throws {DomainError} `PROJ_ACCESS_DENIED` se o usuário não participa.
 */
export async function assertProjectAccess(
  client: PoolClient,
  userId: string | null,
  projectId: string,
): Promise<void> {
  if (!userId) {
    throw new DomainError(ErrorCode.AUTH_UNAUTHORIZED, "Requisição não autenticada.", {});
  }
  const { rows } = await client.query<{ owner_user_id: string }>(
    `SELECT owner_user_id FROM mod_projetos.projects WHERE id = $1`,
    [projectId],
  );
  const project = rows[0];
  if (!project) {
    throw new DomainError(ErrorCode.PROJ_NOT_FOUND, "Projeto não encontrado.", { project_id: projectId });
  }
  if (project.owner_user_id === userId) return;
  const member = await client.query(
    `SELECT 1 FROM mod_projetos.project_members WHERE project_id = $1 AND user_id = $2`,
    [projectId, userId],
  );
  if (member.rowCount === 0) {
    throw new DomainError(ErrorCode.PROJ_ACCESS_DENIED, "Acesso negado ao projeto.", { project_id: projectId });
  }
}

/**
 * Indica se o usuário é SuperAdministrador ou dono do projeto (para ações
 * privilegiadas: desarquivar, relatório executivo).
 *
 * @param client - Cliente PostgreSQL.
 * @param userId - `user_id` autenticado.
 * @param projectId - `id` do projeto.
 * @returns `true` se superadmin ou dono.
 */
export async function isSuperadminOrOwner(
  client: PoolClient,
  userId: string | null,
  projectId: string,
): Promise<boolean> {
  if (!userId) return false;
  const { rows } = await client.query<{ ok: boolean }>(
    `SELECT (
       EXISTS (SELECT 1 FROM core.users WHERE id = $1 AND role = 'superadmin')
       OR EXISTS (SELECT 1 FROM mod_projetos.projects WHERE id = $2 AND owner_user_id = $1)
     ) AS ok`,
    [userId, projectId],
  );
  return rows[0]?.ok ?? false;
}

/**
 * Indica se o usuário é SuperAdministrador (para o dashboard global).
 *
 * @param client - Cliente PostgreSQL.
 * @param userId - `user_id` autenticado.
 * @returns `true` se superadmin.
 */
export async function isSuperadmin(client: PoolClient, userId: string | null): Promise<boolean> {
  if (!userId) return false;
  const { rows } = await client.query<{ ok: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM core.users WHERE id = $1 AND role = 'superadmin') AS ok`,
    [userId],
  );
  return rows[0]?.ok ?? false;
}

/**
 * Garante que o projeto não está arquivado (para operações de escrita).
 *
 * @param client - Cliente PostgreSQL.
 * @param projectId - `id` do projeto.
 * @throws {DomainError} `PROJ_ARCHIVED` se o projeto estiver arquivado.
 */
export async function assertNotArchived(client: PoolClient, projectId: string): Promise<void> {
  const { rows } = await client.query<{ status: string }>(
    `SELECT status FROM mod_projetos.projects WHERE id = $1`,
    [projectId],
  );
  if (rows[0]?.status === "arquivado") {
    throw new DomainError(ErrorCode.PROJ_ARCHIVED, "Projeto arquivado; operação não permitida.", { project_id: projectId });
  }
}

/**
 * Cria um projeto e adiciona o dono como membro. Audita.
 *
 * @param client - Cliente PostgreSQL.
 * @param input - Dados do projeto (o `ownerUserId` default é o autor).
 * @param actorUserId - Autor.
 * @returns O projeto criado.
 */
export async function createProject(
  client: PoolClient,
  input: {
    name: string;
    description?: string | undefined;
    detail?: string | undefined;
    ownerUserId?: string | undefined;
    dueDate?: string | undefined;
    hourlyRate?: number | undefined;
    warnDays?: number | undefined;
  },
  actorUserId: string | null = null,
): Promise<Project> {
  const ownerId = input.ownerUserId ?? actorUserId;
  if (!ownerId) {
    throw new DomainError(ErrorCode.AUTH_UNAUTHORIZED, "Dono do projeto não informado.", {});
  }
  const { rows } = await client.query<Project>(
    `INSERT INTO mod_projetos.projects (name, description, detail, owner_user_id, created_by, due_date, hourly_rate, warn_days)
     VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, 2))
     RETURNING ${COLUMNS}`,
    [
      input.name, input.description ?? null, input.detail ?? null, ownerId, actorUserId,
      input.dueDate ?? null, input.hourlyRate ?? 0, input.warnDays ?? null,
    ],
  );
  const project = rows[0] as Project;

  // Dono também é membro (idempotente).
  await client.query(
    `INSERT INTO mod_projetos.project_members (project_id, user_id)
     VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [project.id, ownerId],
  );

  await auditLog(client, {
    userId: actorUserId,
    module: "projetos",
    action: "PROJ_PROJETO_CRIADO",
    payloadAfter: { project_id: project.id, owner_user_id: ownerId },
  });
  return project;
}

/**
 * Edita nome, descrição, descritivo principal e/ou dono de um projeto. Audita.
 *
 * @param client - Cliente PostgreSQL.
 * @param id - `id` do projeto.
 * @param patch - Campos a alterar.
 * @param actorUserId - Autor.
 * @returns O projeto atualizado, ou `null` se não existe.
 */
export async function updateProject(
  client: PoolClient,
  id: string,
  patch: {
    name?: string;
    description?: string | null;
    detail?: string | null;
    ownerUserId?: string;
    dueDate?: string | null;
    hourlyRate?: number;
    warnDays?: number;
  },
  actorUserId: string | null = null,
): Promise<Project | null> {
  const { rows } = await client.query<Project>(
    `UPDATE mod_projetos.projects SET
       name = COALESCE($2, name),
       description = COALESCE($3, description),
       detail = COALESCE($4, detail),
       owner_user_id = COALESCE($5, owner_user_id),
       due_date = COALESCE($6, due_date),
       hourly_rate = COALESCE($7, hourly_rate),
       warn_days = COALESCE($8, warn_days),
       updated_at = now()
     WHERE id = $1 RETURNING ${COLUMNS}`,
    [
      id, patch.name ?? null, patch.description ?? null, patch.detail ?? null, patch.ownerUserId ?? null,
      patch.dueDate ?? null, patch.hourlyRate ?? null, patch.warnDays ?? null,
    ],
  );
  const project = rows[0] ?? null;
  if (!project) return null;

  // Se o dono mudou, garante que ele é membro.
  if (patch.ownerUserId) {
    await client.query(
      `INSERT INTO mod_projetos.project_members (project_id, user_id)
       VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [id, patch.ownerUserId],
    );
  }

  await auditLog(client, {
    userId: actorUserId,
    module: "projetos",
    action: "PROJ_PROJETO_EDITADO",
    payloadAfter: { project_id: id },
  });
  return project;
}

/**
 * Arquiva um projeto (status `arquivado`). Audita.
 *
 * @param client - Cliente PostgreSQL.
 * @param id - `id` do projeto.
 * @param actorUserId - Autor.
 * @returns O projeto arquivado, ou `null` se não existe.
 */
export async function archiveProject(
  client: PoolClient,
  id: string,
  actorUserId: string | null = null,
): Promise<Project | null> {
  const { rows } = await client.query<Project>(
    `UPDATE mod_projetos.projects SET status = 'arquivado', updated_at = now()
     WHERE id = $1 RETURNING ${COLUMNS}`,
    [id],
  );
  const project = rows[0] ?? null;
  if (!project) return null;
  await auditLog(client, {
    userId: actorUserId,
    module: "projetos",
    action: "PROJ_PROJETO_ARQUIVADO",
    payloadAfter: { project_id: id },
  });
  return project;
}

/**
 * Desarquiva um projeto (volta a `ativo`). Restrito na rota ao superadmin ou
 * dono do projeto. Audita.
 *
 * @param client - Cliente PostgreSQL.
 * @param id - `id` do projeto.
 * @param actorUserId - Autor.
 * @returns O projeto reativado.
 * @throws {DomainError} `PROJ_NOT_FOUND` se não existe; `PROJ_NOT_ARCHIVED` se já está ativo.
 */
export async function unarchiveProject(
  client: PoolClient,
  id: string,
  actorUserId: string | null = null,
): Promise<Project> {
  const current = await client.query<{ status: string }>(
    `SELECT status FROM mod_projetos.projects WHERE id = $1`,
    [id],
  );
  if (current.rowCount === 0) {
    throw new DomainError(ErrorCode.PROJ_NOT_FOUND, "Projeto não encontrado.", { project_id: id });
  }
  if (current.rows[0]!.status !== "arquivado") {
    throw new DomainError(ErrorCode.PROJ_NOT_ARCHIVED, "Projeto não está arquivado.", { project_id: id });
  }
  const { rows } = await client.query<Project>(
    `UPDATE mod_projetos.projects SET status = 'ativo', updated_at = now()
     WHERE id = $1 RETURNING ${COLUMNS}`,
    [id],
  );
  await auditLog(client, {
    userId: actorUserId, module: "projetos", action: "PROJ_PROJETO_DESARQUIVADO",
    payloadAfter: { project_id: id },
  });
  return rows[0] as Project;
}

/**
 * Calcula os totais de tempo e custo de um projeto.
 *
 * @param client - Cliente PostgreSQL.
 * @param id - `id` do projeto.
 * @returns Minutos totais e custos (mão de obra, recursos e total).
 */
export async function getProjectTotals(client: PoolClient, id: string): Promise<ProjectTotals> {
  const { rows } = await client.query<{ hourly_rate: string }>(
    `SELECT hourly_rate FROM mod_projetos.projects WHERE id = $1`,
    [id],
  );
  const hourlyRate = Number(rows[0]?.hourly_rate ?? 0);

  const minutesRes = await client.query<{ total: string }>(
    `SELECT COALESCE(SUM(tc.minutes), 0)::text AS total
     FROM mod_projetos.task_comments tc
     JOIN mod_projetos.tasks t ON t.id = tc.task_id
     WHERE t.project_id = $1`,
    [id],
  );
  const totalMinutes = Number(minutesRes.rows[0]?.total ?? 0);

  const resourceRes = await client.query<{ total: string }>(
    `SELECT COALESCE(SUM(cost), 0)::text AS total FROM mod_projetos.project_resources WHERE project_id = $1`,
    [id],
  );
  const resourceCost = Number(resourceRes.rows[0]?.total ?? 0);

  const laborCost = (totalMinutes / 60) * hourlyRate;
  return {
    total_minutes: totalMinutes,
    labor_cost: Math.round(laborCost * 100) / 100,
    resource_cost: Math.round(resourceCost * 100) / 100,
    total_cost: Math.round((laborCost + resourceCost) * 100) / 100,
  };
}

/**
 * Lista os projetos em que o usuário é dono ou membro (fonte da regra de
 * acesso: não retorna projetos alheios).
 *
 * @param client - Cliente PostgreSQL.
 * @param userId - `user_id` autenticado.
 * @returns Os projetos do usuário, mais recentes primeiro.
 */
export async function listProjectsForUser(client: PoolClient, userId: string): Promise<Project[]> {
  const { rows } = await client.query<Project>(
    `SELECT ${COLUMNS.split(", ").map((c) => `p.${c}`).join(", ")}
     FROM mod_projetos.projects p
     WHERE p.owner_user_id = $1
        OR EXISTS (SELECT 1 FROM mod_projetos.project_members m WHERE m.project_id = p.id AND m.user_id = $1)
     ORDER BY p.updated_at DESC`,
    [userId],
  );
  return rows;
}

/**
 * Retorna o detalhe de um projeto (com membros e comentários), aplicando a
 * regra de acesso: só dono ou membro.
 *
 * @param client - Cliente PostgreSQL.
 * @param id - `id` do projeto.
 * @param userId - `user_id` autenticado.
 * @returns A visão do projeto.
 * @throws {DomainError} `PROJ_NOT_FOUND`/`PROJ_ACCESS_DENIED` conforme o caso.
 */
export async function getProject(client: PoolClient, id: string, userId: string): Promise<ProjectView> {
  await assertProjectAccess(client, userId, id);
  const { rows } = await client.query<Project>(
    `SELECT ${COLUMNS} FROM mod_projetos.projects WHERE id = $1`,
    [id],
  );
  const project = rows[0] as Project;

  const members = await client.query<{ user_id: string; full_name: string | null; email: string }>(
    `SELECT m.user_id, u.full_name, u.email
     FROM mod_projetos.project_members m
     JOIN core.users u ON u.id = m.user_id
     WHERE m.project_id = $1
     ORDER BY u.full_name`,
    [id],
  );
  const comments = await client.query<{ id: string; author_user_id: string; author_name: string | null; body: string; created_at: Date }>(
    `SELECT c.id, c.author_user_id, u.full_name AS author_name, c.body, c.created_at
     FROM mod_projetos.project_comments c
     JOIN core.users u ON u.id = c.author_user_id
     WHERE c.project_id = $1
     ORDER BY c.created_at`,
    [id],
  );
  const resources = await client.query<{ id: string; description: string; cost: string; created_at: Date }>(
    `SELECT id, description, cost, created_at FROM mod_projetos.project_resources
     WHERE project_id = $1 ORDER BY created_at`,
    [id],
  );
  const totals = await getProjectTotals(client, id);
  return { ...project, members: members.rows, comments: comments.rows, resources: resources.rows, totals };
}

/**
 * Adiciona um recurso/custo ao projeto. Audita.
 *
 * @param client - Cliente PostgreSQL.
 * @param projectId - `id` do projeto.
 * @param input - Descrição e custo (R$).
 * @param actorUserId - Autor.
 * @returns O recurso criado.
 */
export async function addResource(
  client: PoolClient,
  projectId: string,
  input: { description: string; cost: number },
  actorUserId: string | null = null,
): Promise<{ id: string; description: string; cost: string; created_at: Date }> {
  const { rows } = await client.query<{ id: string; description: string; cost: string; created_at: Date }>(
    `INSERT INTO mod_projetos.project_resources (project_id, description, cost)
     VALUES ($1, $2, $3) RETURNING id, description, cost, created_at`,
    [projectId, input.description, input.cost],
  );
  await auditLog(client, {
    userId: actorUserId, module: "projetos", action: "PROJ_RECURSO_ADICIONADO",
    payloadAfter: { project_id: projectId, resource_id: rows[0]!.id, cost: input.cost },
  });
  return rows[0]!;
}

/**
 * Remove um recurso/custo do projeto.
 *
 * @param client - Cliente PostgreSQL.
 * @param resourceId - `id` do recurso.
 * @returns `true` se removeu.
 */
export async function removeResource(client: PoolClient, resourceId: string): Promise<boolean> {
  const { rowCount } = await client.query(
    `DELETE FROM mod_projetos.project_resources WHERE id = $1`,
    [resourceId],
  );
  return (rowCount ?? 0) > 0;
}
