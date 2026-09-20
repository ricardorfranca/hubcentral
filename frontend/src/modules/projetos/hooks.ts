/**
 * @file hooks.ts
 * @module modules/projetos
 *
 * Hooks TanStack Query do Módulo de Projetos: projetos, membros, tarefas,
 * atribuições, comentários e anexos, com invalidação de cache.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  listProjects, getProject, createProject, updateProject, archiveProject,
  addMember, removeMember, addProjectComment,
  listTasks, createTask, getTask, updateTask, moveTask,
  assignTask, unassignTask, addTaskComment,
  uploadAttachment, deleteAttachment,
  type TaskStatus,
} from "../../core/api/projetos.js";

const keys = {
  projects: ["projetos", "list"] as const,
  project: (id: string) => ["projetos", "project", id] as const,
  tasks: (projectId: string) => ["projetos", "tasks", projectId] as const,
  task: (id: string) => ["projetos", "task", id] as const,
};

// --- Projetos ---

export function useProjects() {
  return useQuery({ queryKey: keys.projects, queryFn: listProjects });
}

export function useProject(id: string) {
  return useQuery({ queryKey: keys.project(id), queryFn: () => getProject(id), enabled: Boolean(id) });
}

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createProject,
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.projects }),
  });
}

export function useUpdateProject(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Parameters<typeof updateProject>[1]) => updateProject(id, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.project(id) });
      qc.invalidateQueries({ queryKey: keys.projects });
    },
  });
}

export function useArchiveProject(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => archiveProject(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.project(id) });
      qc.invalidateQueries({ queryKey: keys.projects });
    },
  });
}

// --- Membros ---

export function useAddMember(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => addMember(projectId, userId),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.project(projectId) }),
  });
}

export function useRemoveMember(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => removeMember(projectId, userId),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.project(projectId) }),
  });
}

export function useAddProjectComment(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => addProjectComment(projectId, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.project(projectId) }),
  });
}

// --- Tarefas ---

export function useTasks(projectId: string) {
  return useQuery({ queryKey: keys.tasks(projectId), queryFn: () => listTasks(projectId), enabled: Boolean(projectId) });
}

export function useTask(id: string) {
  return useQuery({ queryKey: keys.task(id), queryFn: () => getTask(id), enabled: Boolean(id) });
}

export function useCreateTask(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { title: string; description?: string | undefined }) => createTask(projectId, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.tasks(projectId) }),
  });
}

export function useUpdateTask(taskId: string, projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: { title?: string; description?: string }) => updateTask(taskId, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.task(taskId) });
      qc.invalidateQueries({ queryKey: keys.tasks(projectId) });
    },
  });
}

export function useMoveTask(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, status, position }: { taskId: string; status: TaskStatus; position?: number }) =>
      moveTask(taskId, status, position),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.tasks(projectId) }),
  });
}

// --- Atribuições e comentários de tarefa ---

export function useAssignTask(taskId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => assignTask(taskId, userId),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.task(taskId) }),
  });
}

export function useUnassignTask(taskId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => unassignTask(taskId, userId),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.task(taskId) }),
  });
}

export function useAddTaskComment(taskId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => addTaskComment(taskId, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.task(taskId) }),
  });
}

export function useUploadAttachment(taskId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => uploadAttachment(taskId, file),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.task(taskId) }),
  });
}

export function useDeleteAttachment(taskId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (attachmentId: string) => deleteAttachment(attachmentId),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.task(taskId) }),
  });
}
