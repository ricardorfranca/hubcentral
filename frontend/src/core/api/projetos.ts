/**
 * @file projetos.ts
 * @module core/api
 *
 * Cliente tipado do Módulo de Projetos Internos: projetos, membros, tarefas
 * (Kanban), atribuições, comentários e anexos.
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
  created_at: string;
}

/** Projeto com membros e comentários. */
export interface ProjectView extends Project {
  members: ProjectMember[];
  comments: (Comment & { author_name: string | null })[];
}

/** Tarefa. */
export interface Task {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  position: number;
  created_at: string;
  updated_at: string;
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

/** Tarefa com atribuídos, comentários e anexos. */
export interface TaskView extends Task {
  assignees: string[];
  comments: (Comment & { author_name: string | null })[];
  attachments: Attachment[];
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
}): Promise<Project> {
  return request<Project>("/api/projetos", { method: "POST", body: input });
}

/** Edita um projeto. */
export function updateProject(id: string, patch: {
  name?: string;
  description?: string;
  detail?: string;
  owner_user_id?: string;
}): Promise<Project> {
  return request<Project>(`/api/projetos/${id}`, { method: "PATCH", body: patch });
}

/** Arquiva um projeto. */
export function archiveProject(id: string): Promise<Project> {
  return request<Project>(`/api/projetos/${id}/archive`, { method: "POST" });
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
export function createTask(projectId: string, input: { title: string; description?: string | undefined }): Promise<Task> {
  return request<Task>(`/api/projetos/${projectId}/tasks`, { method: "POST", body: input });
}

/** Detalhe de uma tarefa. */
export function getTask(taskId: string): Promise<TaskView> {
  return request<TaskView>(`/api/projetos/tasks/${taskId}`);
}

/** Edita uma tarefa. */
export function updateTask(taskId: string, patch: { title?: string; description?: string }): Promise<Task> {
  return request<Task>(`/api/projetos/tasks/${taskId}`, { method: "PATCH", body: patch });
}

/** Move uma tarefa de coluna. */
export function moveTask(taskId: string, status: TaskStatus, position?: number): Promise<Task> {
  return request<Task>(`/api/projetos/tasks/${taskId}/move`, { method: "PATCH", body: { status, position } });
}

// --- Atribuições ---

/** Atribui a tarefa a um usuário. */
export function assignTask(taskId: string, userId: string): Promise<void> {
  return request<void>(`/api/projetos/tasks/${taskId}/assignees`, { method: "POST", body: { user_id: userId } });
}

/** Remove a atribuição de um usuário. */
export function unassignTask(taskId: string, userId: string): Promise<void> {
  return request<void>(`/api/projetos/tasks/${taskId}/assignees/${userId}`, { method: "DELETE" });
}

// --- Comentários de tarefa ---

/** Comenta em uma tarefa. */
export function addTaskComment(taskId: string, body: string): Promise<Comment> {
  return request<Comment>(`/api/projetos/tasks/${taskId}/comments`, { method: "POST", body: { body } });
}

// --- Anexos ---

/**
 * Envia um anexo (multipart) para uma tarefa. Usa fetch diretamente por conta
 * do corpo FormData (o cliente JSON padrão não serve aqui).
 */
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
    const body = await res.json().catch(() => ({ code: "UNKNOWN", message: "Falha no upload." }));
    throw new Error(body.message ?? "Falha no upload.");
  }
  return res.json() as Promise<Attachment>;
}

/** URL de download de um anexo (autenticação via header no fetch do navegador). */
export function attachmentUrl(attachmentId: string): string {
  return `/api/projetos/attachments/${attachmentId}`;
}

/** Usuário do diretório (para seleção de membros/atribuídos). */
export interface DirectoryUser {
  id: string;
  full_name: string | null;
  email: string;
}

/** Lista usuários ativos para seleção (requer gerenciar membros). */
export function listDirectoryUsers(): Promise<DirectoryUser[]> {
  return request<DirectoryUser[]>("/api/projetos/users");
}

/** Exclui um anexo. */
export function deleteAttachment(attachmentId: string): Promise<void> {
  return request<void>(`/api/projetos/attachments/${attachmentId}`, { method: "DELETE" });
}
