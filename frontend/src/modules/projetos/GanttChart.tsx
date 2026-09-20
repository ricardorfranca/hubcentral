/**
 * @file GanttChart.tsx
 * @module modules/projetos
 *
 * Gráfico de Gantt simples (SVG) das tarefas do projeto, baseado nos prazos.
 * Cada tarefa vira uma barra do dia de criação até o prazo (ou do prazo até
 * hoje, se sem data de criação clara). Barras coloridas por status e atraso.
 */

import { useMemo } from "react";
import { Box, Typography, CircularProgress } from "@mui/material";
import { useTasks } from "./hooks.js";
import type { Task } from "../../core/api/projetos.js";

/** Converte data ISO em Date (00:00). */
function d(iso: string): Date {
  const x = new Date(iso);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** Props do Gantt. */
interface Props {
  projectId: string;
  projectDue: string | null;
}

/**
 * Gráfico de Gantt do projeto.
 *
 * @param props - Projeto e prazo.
 * @returns O gráfico (SVG) ou um aviso se não houver datas.
 */
export function GanttChart({ projectId, projectDue }: Props): JSX.Element {
  const { data: tasks, isLoading } = useTasks(projectId);

  const model = useMemo(() => {
    const list = (tasks ?? []).filter((t) => t.due_date || t.created_at);
    if (list.length === 0) return null;

    // Janela de tempo: do menor início ao maior fim (prazo do projeto incluído).
    const starts = list.map((t) => d(t.created_at));
    const ends = list.map((t) => (t.due_date ? d(t.due_date) : d(t.created_at)));
    if (projectDue) ends.push(d(projectDue));
    const min = new Date(Math.min(...starts.map((x) => x.getTime())));
    const max = new Date(Math.max(...ends.map((x) => x.getTime())));
    const totalDays = Math.max(1, Math.round((max.getTime() - min.getTime()) / 86_400_000));
    return { list, min, max, totalDays };
  }, [tasks, projectDue]);

  if (isLoading) {
    return <Box sx={{ display: "grid", placeItems: "center", height: 160 }}><CircularProgress /></Box>;
  }
  if (!model) {
    return <Typography color="text.secondary">Defina prazos nas tarefas para visualizar o Gantt.</Typography>;
  }

  const { list, min, totalDays } = model;
  const rowH = 28;
  const width = 720;
  const labelW = 180;
  const chartW = width - labelW;
  const height = list.length * rowH + 24;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  function x(date: Date): number {
    const days = (date.getTime() - min.getTime()) / 86_400_000;
    return labelW + (days / totalDays) * chartW;
  }

  function barColor(t: Task): string {
    if (t.status === "finalizada") return "#43a047";
    if (t.due_date && d(t.due_date) < today) return "#e53935"; // atrasada
    if (t.status === "em_execucao") return "#1e88e5";
    return "#90a4ae";
  }

  const todayX = x(today);

  return (
    <Box sx={{ overflowX: "auto" }}>
      <svg width={width} height={height} role="img" aria-label="Gráfico de Gantt do projeto">
        {/* Linha do dia atual. */}
        {todayX >= labelW && todayX <= width && (
          <line x1={todayX} y1={0} x2={todayX} y2={height - 24} stroke="#ff7043" strokeDasharray="4 3" />
        )}
        {list.map((t, i) => {
          const y = i * rowH + 8;
          const start = d(t.created_at);
          const end = t.due_date ? d(t.due_date) : start;
          const bx = x(start);
          const bw = Math.max(6, x(end) - bx);
          return (
            <g key={t.id}>
              <text x={4} y={y + 12} fontSize={11} fill="#555">
                {t.title.length > 26 ? `${t.title.slice(0, 25)}…` : t.title}
              </text>
              <rect x={bx} y={y} width={bw} height={16} rx={4} fill={barColor(t)} opacity={0.85} />
            </g>
          );
        })}
      </svg>
    </Box>
  );
}
