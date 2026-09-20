/**
 * @file format.ts
 * @module modules/projetos
 *
 * Helpers de formatação e de estado visual (cores de prazo) das tarefas.
 */

import type { Task } from "../../core/api/projetos.js";

/** Formata minutos como "Xh Ymin". */
export function fmtMinutes(min: number | undefined): string {
  const m = min ?? 0;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}min`;
}

/** Formata um valor (número ou string) como moeda BRL. */
export function brl(value: number | string | null | undefined): string {
  const n = typeof value === "string" ? Number(value) : value ?? 0;
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number.isFinite(n) ? (n as number) : 0);
}

/** Diferença em dias (inteiro) entre hoje (00:00) e uma data ISO (YYYY-MM-DD). */
function daysUntil(dateIso: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dateIso);
  due.setHours(0, 0, 0, 0);
  return Math.round((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

/** Estado de prazo de uma tarefa para colorir o card. */
export type DueState = "overdue" | "warning" | "ok";

/**
 * Determina o estado de prazo de uma tarefa. Tarefas finalizadas ou sem prazo
 * são sempre `ok`. Vencida → `overdue`; a `warn_days` ou menos do vencimento →
 * `warning`.
 *
 * @param task - A tarefa.
 * @param projectWarnDays - `warn_days` do projeto (default de alerta).
 * @returns O estado de prazo.
 */
export function dueState(task: Task, projectWarnDays: number): DueState {
  if (task.status === "finalizada" || !task.due_date) return "ok";
  const warn = task.warn_days ?? projectWarnDays;
  const days = daysUntil(task.due_date);
  if (days < 0) return "overdue";
  if (days <= warn) return "warning";
  return "ok";
}

/** Cores suaves de fundo por estado de prazo (claras, não agressivas). */
export const DUE_BG: Record<DueState, string | undefined> = {
  overdue: "rgba(229, 57, 53, 0.12)", // vermelho suave
  warning: "rgba(251, 192, 45, 0.18)", // amarelo suave
  ok: undefined,
};
