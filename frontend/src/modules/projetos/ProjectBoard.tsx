/**
 * @file ProjectBoard.tsx
 * @module modules/projetos
 *
 * Kanban de 3 colunas fixas (Não iniciadas / Em execução / Finalizadas) das
 * tarefas de um projeto. Drag-and-drop move entre colunas (requer
 * `projetos:tarefa:mover`). Criar tarefa e abrir o detalhe.
 */

import { useMemo, useState } from "react";
import {
  Box, Paper, Typography, Card, CardActionArea, CardContent, Button, Stack, CircularProgress,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import { useTasks, useMoveTask, useCreateTask } from "./hooks.js";
import { useCan } from "../../core/rbac/can.js";
import type { Task, TaskStatus } from "../../core/api/projetos.js";

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
  onOpenTask: (taskId: string) => void;
}

/**
 * Kanban das tarefas de um projeto.
 *
 * @param props - Projeto, estado de arquivamento e callback de abrir tarefa.
 * @returns O quadro Kanban.
 */
export function ProjectBoard({ projectId, archived, onOpenTask }: Props): JSX.Element {
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
          <Button size="small" startIcon={<AddIcon />} onClick={() => setDialogOpen(true)}>
            Nova tarefa
          </Button>
        )}
      </Stack>

      <Box sx={{ display: "flex", gap: 2, overflowX: "auto", pb: 1 }}>
        {COLUMNS.map((col) => {
          const items = byColumn.get(col.id) ?? [];
          return (
            <Paper
              key={col.id}
              variant="outlined"
              sx={{ minWidth: 280, width: 280, p: 1, bgcolor: "grey.50" }}
              onDragOver={(e) => canMove && e.preventDefault()}
              onDrop={(e) => onDrop(col.id, e)}
            >
              <Typography variant="subtitle2" sx={{ px: 1, py: 0.5 }}>
                {col.label} ({items.length})
              </Typography>
              <Stack spacing={1}>
                {items.map((t) => (
                  <Card
                    key={t.id}
                    draggable={canMove}
                    onDragStart={(e) => e.dataTransfer.setData("text/task-id", t.id)}
                    sx={{ cursor: canMove ? "grab" : "pointer" }}
                  >
                    <CardActionArea onClick={() => onOpenTask(t.id)}>
                      <CardContent sx={{ py: 1.5 }}>
                        <Typography variant="body2" fontWeight={600}>{t.title}</Typography>
                        {t.description && (
                          <Typography variant="caption" color="text.secondary" sx={{
                            display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
                          }}>
                            {t.description}
                          </Typography>
                        )}
                      </CardContent>
                    </CardActionArea>
                  </Card>
                ))}
                {items.length === 0 && (
                  <Typography variant="caption" color="text.secondary" sx={{ px: 1 }}>Vazio.</Typography>
                )}
              </Stack>
            </Paper>
          );
        })}
      </Box>

      <NewTaskDialog projectId={projectId} open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </Box>
  );
}

/** Diálogo de criação de tarefa. */
function NewTaskDialog({ projectId, open, onClose }: { projectId: string; open: boolean; onClose: () => void }): JSX.Element {
  const create = useCreateTask(projectId);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  async function submit(): Promise<void> {
    if (!title.trim()) return;
    await create.mutateAsync({ title: title.trim(), description: description.trim() || undefined });
    setTitle(""); setDescription("");
    onClose();
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Nova tarefa</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField label="Título" value={title} onChange={(e) => setTitle(e.target.value)} required />
          <TextField label="Descrição" value={description} onChange={(e) => setDescription(e.target.value)} multiline minRows={3} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancelar</Button>
        <Button variant="contained" onClick={submit} disabled={create.isPending}>Criar</Button>
      </DialogActions>
    </Dialog>
  );
}
