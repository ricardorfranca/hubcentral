/**
 * @file ProjectBoard.tsx
 * @module modules/projetos
 *
 * Kanban de 3 colunas fixas das tarefas de um projeto. Cartões mostram prazo,
 * horas apontadas e responsável; a cor de fundo sinaliza atraso (vermelho
 * suave) ou proximidade do prazo (amarelo). Criar tarefa com prazo, responsável,
 * visibilidade e dependência.
 */

import { useMemo, useState } from "react";
import {
  Box, Paper, Typography, Card, CardActionArea, CardContent, Button, Stack, CircularProgress,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField, MenuItem, FormControlLabel, Switch, Chip,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import ScheduleIcon from "@mui/icons-material/Schedule";
import { useTasks, useMoveTask, useCreateTask } from "./hooks.js";
import { useCan } from "../../core/rbac/can.js";
import { dueState, DUE_BG, fmtMinutes } from "./format.js";
import type { Task, TaskStatus, ProjectMember } from "../../core/api/projetos.js";

/** Colunas fixas do Kanban, na ordem. */
const COLUMNS: { id: TaskStatus; label: string }[] = [
  { id: "nao_iniciada", label: "Não iniciadas" },
  { id: "em_execucao", label: "Em execução" },
  { id: "finalizada", label: "Finalizadas" },
];

/** Props do board. */
interface Props {
  projectId: string;
  archived: boolean;
  warnDays: number;
  members: ProjectMember[];
  onOpenTask: (taskId: string) => void;
}

/**
 * Kanban das tarefas de um projeto.
 *
 * @param props - Projeto, alerta, membros e callback de abrir tarefa.
 * @returns O quadro Kanban.
 */
export function ProjectBoard({ projectId, archived, warnDays, members, onOpenTask }: Props): JSX.Element {
  const can = useCan();
  const canMove = can("projetos:tarefa:mover") && !archived;
  const canCreate = can("projetos:tarefa:criar") && !archived;
  const { data: tasks, isLoading } = useTasks(projectId);
  const move = useMoveTask(projectId);
  const [dialogOpen, setDialogOpen] = useState(false);

  const byColumn = useMemo(() => {
    const map = new Map<TaskStatus, Task[]>();
    for (const col of COLUMNS) map.set(col.id, []);
    for (const t of tasks ?? []) map.get(t.status)?.push(t);
    return map;
  }, [tasks]);

  function memberName(id: string | null): string | null {
    if (!id) return null;
    return members.find((m) => m.user_id === id)?.full_name ?? null;
  }

  function onDrop(status: TaskStatus, e: React.DragEvent): void {
    e.preventDefault();
    const taskId = e.dataTransfer.getData("text/task-id");
    if (taskId && canMove) move.mutate({ taskId, status });
  }

  if (isLoading) {
    return <Box sx={{ display: "grid", placeItems: "center", height: 200 }}><CircularProgress /></Box>;
  }

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
        <Typography variant="h6">Tarefas</Typography>
        {canCreate && (
          <Button size="small" startIcon={<AddIcon />} onClick={() => setDialogOpen(true)}>Nova tarefa</Button>
        )}
      </Stack>

      <Box sx={{ display: "flex", gap: 2, overflowX: "auto", pb: 1 }}>
        {COLUMNS.map((col) => {
          const items = byColumn.get(col.id) ?? [];
          return (
            <Paper
              key={col.id}
              variant="outlined"
              sx={{ minWidth: 280, width: 280, p: 1, bgcolor: "action.hover" }}
              onDragOver={(e) => canMove && e.preventDefault()}
              onDrop={(e) => onDrop(col.id, e)}
            >
              <Typography variant="subtitle2" sx={{ px: 1, py: 0.5 }}>{col.label} ({items.length})</Typography>
              <Stack spacing={1}>
                {items.map((t) => {
                  const state = dueState(t, warnDays);
                  const assignee = memberName(t.assignee_user_id);
                  return (
                    <Card
                      key={t.id}
                      draggable={canMove}
                      onDragStart={(e) => e.dataTransfer.setData("text/task-id", t.id)}
                      sx={{ cursor: canMove ? "grab" : "pointer", bgcolor: DUE_BG[state] }}
                    >
                      <CardActionArea onClick={() => onOpenTask(t.id)}>
                        <CardContent sx={{ py: 1.5 }}>
                          <Typography variant="body2" fontWeight={600}>{t.title}</Typography>
                          <Stack direction="row" spacing={1} sx={{ mt: 0.5, flexWrap: "wrap", gap: 0.5 }}>
                            {t.due_date && (
                              <Chip
                                size="small"
                                icon={<ScheduleIcon />}
                                label={new Date(t.due_date).toLocaleDateString("pt-BR")}
                                color={state === "overdue" ? "error" : state === "warning" ? "warning" : "default"}
                                variant="outlined"
                              />
                            )}
                            {(t.minutes_total ?? 0) > 0 && (
                              <Chip size="small" label={fmtMinutes(t.minutes_total)} variant="outlined" />
                            )}
                          </Stack>
                          {assignee && (
                            <Typography variant="caption" display="block" color="text.secondary" sx={{ mt: 0.5 }}>
                              {assignee}
                            </Typography>
                          )}
                          {t.depends_on_task_id && (
                            <Typography variant="caption" display="block" color="text.secondary">
                              depende de outra tarefa
                            </Typography>
                          )}
                        </CardContent>
                      </CardActionArea>
                    </Card>
                  );
                })}
                {items.length === 0 && (
                  <Typography variant="caption" color="text.secondary" sx={{ px: 1 }}>Vazio.</Typography>
                )}
              </Stack>
            </Paper>
          );
        })}
      </Box>

      <NewTaskDialog
        projectId={projectId}
        members={members}
        tasks={tasks ?? []}
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
      />
    </Box>
  );
}

/** Diálogo de criação de tarefa com prazo, responsável, visibilidade e dependência. */
function NewTaskDialog({
  projectId, members, tasks, open, onClose,
}: {
  projectId: string;
  members: ProjectMember[];
  tasks: Task[];
  open: boolean;
  onClose: () => void;
}): JSX.Element {
  const create = useCreateTask(projectId);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [assignee, setAssignee] = useState("");
  const [dependsOn, setDependsOn] = useState("");
  const [visibleToAll, setVisibleToAll] = useState(true);

  async function submit(): Promise<void> {
    if (!title.trim()) return;
    await create.mutateAsync({
      title: title.trim(),
      description: description.trim() || undefined,
      due_date: dueDate || undefined,
      assignee_user_id: assignee || undefined,
      depends_on_task_id: dependsOn || undefined,
      visible_to_all: visibleToAll,
    });
    setTitle(""); setDescription(""); setDueDate(""); setAssignee(""); setDependsOn(""); setVisibleToAll(true);
    onClose();
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Nova tarefa</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField label="Título" value={title} onChange={(e) => setTitle(e.target.value)} required />
          <TextField label="Descrição" value={description} onChange={(e) => setDescription(e.target.value)} multiline minRows={3} />
          <Stack direction="row" spacing={2}>
            <TextField
              label="Prazo" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)}
              InputLabelProps={{ shrink: true }} fullWidth
            />
            <TextField select label="Responsável" value={assignee} onChange={(e) => setAssignee(e.target.value)} fullWidth>
              <MenuItem value="">—</MenuItem>
              {members.map((m) => <MenuItem key={m.user_id} value={m.user_id}>{m.full_name ?? m.email}</MenuItem>)}
            </TextField>
          </Stack>
          <TextField select label="Depende de" value={dependsOn} onChange={(e) => setDependsOn(e.target.value)}>
            <MenuItem value="">Nenhuma</MenuItem>
            {tasks.map((t) => <MenuItem key={t.id} value={t.id}>{t.title}</MenuItem>)}
          </TextField>
          <FormControlLabel
            control={<Switch checked={visibleToAll} onChange={(e) => setVisibleToAll(e.target.checked)} />}
            label="Visível a todos os participantes do projeto"
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancelar</Button>
        <Button variant="contained" onClick={submit} disabled={create.isPending}>Criar</Button>
      </DialogActions>
    </Dialog>
  );
}
