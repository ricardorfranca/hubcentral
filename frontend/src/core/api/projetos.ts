/**
 * @file projetos.ts
 * @module core/api
 *
 * Cliente tipado do Módulo de Projetos Internos (2.0): projetos (prazo, valor/
 * hora, recursos, totais), tarefas (prazo, responsável único, visibilidade,
 * dependência, tempo), comentários, anexos, relatório PDF e dashboard.
 */

import { request } from "./client.js";
import { getToken } from "../auth/session-store.js";

/** Status (coluna do Kanban) de uma tarefa. */
export type TaskStatus = "nao_iniciada" | "em_execucao" | "finalizada";

/** Projeto. */
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
  created_at: string;
  updated_at: string;
}

/** Membro de projeto. */
export interface ProjectMember {
  user_id: string;
  full_name: string | null;
  email: string;
  added_at: string;
}

/** Comentário (projeto ou tarefa). */
export interface Comment {
  id: string;
  author_user_id: string;
  author_name?: string | null;
  body: string;
  minutes?: number;
  created_at: string;
}

/** Recurso/custo do projeto. */
export interface Resource {
  id: string;
  description: string;
  cost: string;
  created_at: string;
}

/** Totais do projeto. */
export interface ProjectTotals {
  total_minutes: number;
  labor_cost: number;
  resource_cost: number;
  total_cost: number;
}

/** Projeto com membros, comentários, recursos e totais. */
export interface ProjectView extends Project {
  members: ProjectMember[];
  comments: (Comment & { author_name: string | null })[];
  resources: Resource[];
  totals: ProjectTotals;
}

/** Tarefa. */
export interface Task {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  position: number;
  due_date: string | null;
  assignee_user_id: string | null;
  visible_to_all: boolean;
  warn_days: number | null;
  depends_on_task_id: string | null;
  created_at: string;
  updated_at: string;
  minutes_total?: number;
}

/** Anexo de tarefa (metadados). */
export interface Attachment {
  id: string;
  task_id: string;
  original_name: string;
  mime_type: string | null;
  size_bytes: number;
  created_at: string;
}

/** Tarefa com comentários, anexos e total de minutos. */
export interface TaskView extends Task {
  comments: (Comment & { author_name: string | null })[];
  attachments: Attachment[];
  minutes_total: number;
}

// --- Projetos ---

/** Lista os projetos do usuário. */
export function listProjects(): Promise<Project[]> {
  return request<Project[]>("/api/projetos");
}

/** Detalhe de um projeto. */
export function getProject(id: string): Promise<ProjectView> {
  return request<ProjectView>(`/api/projetos/${id}`);
}

/** Cria um projeto. */
export function createProject(input: {
  name: string;
  description?: string | undefined;
  detail?: string | undefined;
  due_date?: string | undefined;
  hourly_rate?: number | undefined;
  warn_days?: number | undefined;
}): Promise<Project> {
  return request<Project>("/api/projetos", { method: "POST", body: input });
}

/** Edita um projeto. */
export function updateProject(id: string, patch: {
  name?: string;
  description?: string;
  detail?: string;
  owner_user_id?: string;
  due_date?: string;
  hourly_rate?: number;
  warn_days?: number;
}): Promise<Project> {
  return request<Project>(`/api/projetos/${id}`, { method: "PATCH", body: patch });
}

/** Arquiva um projeto. */
export function archiveProject(id: string): Promise<Project> {
  return request<Project>(`/api/projetos/${id}/archive`, { method: "POST" });
}

/** Desarquiva um projeto (superadmin ou dono). */
export function unarchiveProject(id: string): Promise<Project> {
  return request<Project>(`/api/projetos/${id}/unarchive`, { method: "POST" });
}

// --- Recursos/custos ---

/** Adiciona um recurso/custo ao projeto. */
export function addResource(projectId: string, description: string, cost: number): Promise<Resource> {
  return request<Resource>(`/api/projetos/${projectId}/resources`, { method: "POST", body: { description, cost } });
}

/** Remove um recurso/custo. */
export function removeResource(projectId: string, resourceId: string): Promise<void> {
  return request<void>(`/api/projetos/${projectId}/resources/${resourceId}`, { method: "DELETE" });
}

// --- Membros ---

/** Lista os membros de um projeto. */
export function listMembers(projectId: string): Promise<ProjectMember[]> {
  return request<ProjectMember[]>(`/api/projetos/${projectId}/members`);
}

/** Adiciona um membro. */
export function addMember(projectId: string, userId: string): Promise<void> {
  return request<void>(`/api/projetos/${projectId}/members`, { method: "POST", body: { user_id: userId } });
}

/** Remove um membro. */
export function removeMember(projectId: string, userId: string): Promise<void> {
  return request<void>(`/api/projetos/${projectId}/members/${userId}`, { method: "DELETE" });
}

// --- Comentários de projeto ---

/** Comenta no nível do projeto. */
export function addProjectComment(projectId: string, body: string): Promise<Comment> {
  return request<Comment>(`/api/projetos/${projectId}/comments`, { method: "POST", body: { body } });
}

// --- Tarefas ---

/** Lista as tarefas de um projeto (Kanban). */
export function listTasks(projectId: string): Promise<Task[]> {
  return request<Task[]>(`/api/projetos/${projectId}/tasks`);
}

/** Cria uma tarefa. */
export function createTask(projectId: string, input: {
  title: string;
  description?: string | undefined;
  due_date?: string | undefined;
  assignee_user_id?: string | undefined;
  visible_to_all?: boolean | undefined;
  depends_on_task_id?: string | undefined;
  warn_days?: number | undefined;
}): Promise<Task> {
  return request<Task>(`/api/projetos/${projectId}/tasks`, { method: "POST", body: input });
}

/** Detalhe de uma tarefa. */
export function getTask(taskId: string): Promise<TaskView> {
  return request<TaskView>(`/api/projetos/tasks/${taskId}`);
}

/** Edita uma tarefa. */
export function updateTask(taskId: string, patch: {
  title?: string;
  description?: string;
  due_date?: string;
  visible_to_all?: boolean;
  depends_on_task_id?: string | null;
  warn_days?: number;
}): Promise<Task> {
  return request<Task>(`/api/projetos/tasks/${taskId}`, { method: "PATCH", body: patch });
}

/** Move uma tarefa de coluna. */
export function moveTask(taskId: string, status: TaskStatus, position?: number): Promise<Task> {
  return request<Task>(`/api/projetos/tasks/${taskId}/move`, { method: "PATCH", body: { status, position } });
}

// --- Responsável único ---

/** Define (ou remove, com null) o responsável de uma tarefa. */
export function setAssignee(taskId: string, userId: string | null): Promise<void> {
  return request<void>(`/api/projetos/tasks/${taskId}/assignee`, { method: "PUT", body: { user_id: userId } });
}

// --- Comentários de tarefa (com apontamento de tempo) ---

/** Comenta em uma tarefa, opcionalmente apontando minutos. */
export function addTaskComment(taskId: string, body: string, minutes = 0): Promise<Comment> {
  return request<Comment>(`/api/projetos/tasks/${taskId}/comments`, { method: "POST", body: { body, minutes } });
}

// --- Anexos ---

/** Envia um anexo (multipart) para uma tarefa. */
export async function uploadAttachment(taskId: string, file: File): Promise<Attachment> {
  const form = new FormData();
  form.append("file", file);
  const token = getToken();
  const res = await fetch(`/api/projetos/tasks/${taskId}/attachments`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: "Falha no upload." }));
    throw new Error(body.message ?? "Falha no upload.");
  }
  return res.json() as Promise<Attachment>;
}

/** URL de download de um anexo. */
export function attachmentUrl(attachmentId: string): string {
  return `/api/projetos/attachments/${attachmentId}`;
}

/** Exclui um anexo. */
export function deleteAttachment(attachmentId: string): Promise<void> {
  return request<void>(`/api/projetos/attachments/${attachmentId}`, { method: "DELETE" });
}

// --- Diretório de usuários ---

/** Usuário do diretório (para seleção de membros/responsável). */
export interface DirectoryUser {
  id: string;
  full_name: string | null;
  email: string;
}

/** Lista usuários ativos para seleção (requer gerenciar membros). */
export function listDirectoryUsers(): Promise<DirectoryUser[]> {
  return request<DirectoryUser[]>("/api/projetos/users");
}

// --- Relatório e dashboard ---

/** Baixa o relatório executivo do projeto em PDF (superadmin ou dono). */
export async function downloadProjectReport(projectId: string): Promise<void> {
  const token = getToken();
  const res = await fetch(`/api/projetos/${projectId}/report`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: "Falha ao gerar relatório." }));
    throw new Error(body.message ?? "Falha ao gerar relatório.");
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `relatorio-projeto-${projectId}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Linha do dashboard por projeto. */
export interface DashboardRow {
  project_id: string;
  name: string;
  status: "ativo" | "arquivado";
  task_count: number;
  done_count: number;
  total_minutes: number;
  labor_cost: number;
  resource_cost: number;
  total_cost: number;
}

/** Dashboard agregado (superadmin). */
export interface DashboardSummary {
  projects: DashboardRow[];
  totals: { project_count: number; total_minutes: number; total_cost: number };
}

/** Obtém o dashboard de projetos (superadmin). */
export function getProjectsDashboard(): Promise<DashboardSummary> {
  return request<DashboardSummary>("/api/projetos/dashboard");
}
