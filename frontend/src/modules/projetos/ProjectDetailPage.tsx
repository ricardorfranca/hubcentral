/**
 * @file ProjectDetailPage.tsx
 * @module modules/projetos
 *
 * Detalhe de um projeto (2.0): dados e descritivo, prazo e valor/hora, membros,
 * recursos/custos e totais, comentários do projeto, Kanban das tarefas, gráfico
 * de Gantt, desarquivar e relatório executivo em PDF.
 */

import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  Box, Typography, Paper, Grid2 as Grid, Stack, Chip, Button, CircularProgress, List, ListItem,
  ListItemText, IconButton, TextField, MenuItem, Divider, Tabs, Tab,
} from "@mui/material";
import ArchiveIcon from "@mui/icons-material/Archive";
import UnarchiveIcon from "@mui/icons-material/Unarchive";
import PersonRemoveIcon from "@mui/icons-material/PersonRemove";
import DeleteIcon from "@mui/icons-material/Delete";
import PictureAsPdfIcon from "@mui/icons-material/PictureAsPdf";
import { useQuery } from "@tanstack/react-query";
import {
  useProject, useArchiveProject, useUnarchiveProject, useAddMember, useRemoveMember,
  useAddProjectComment, useAddResource, useRemoveResource,
} from "./hooks.js";
import { useCan } from "../../core/rbac/can.js";
import { listDirectoryUsers, downloadProjectReport } from "../../core/api/projetos.js";
import { ProjectBoard } from "./ProjectBoard.js";
import { TaskDetailDialog } from "./TaskDetailDialog.js";
import { GanttChart } from "./GanttChart.js";
import { brl, fmtMinutes } from "./format.js";

/**
 * Página de detalhe de um projeto.
 *
 * @returns A tela de detalhe.
 */
export function ProjectDetailPage(): JSX.Element {
  const { id = "", taskId } = useParams();
  const navigate = useNavigate();
  const can = useCan();
  const { data: project, isLoading } = useProject(id);
  const archive = useArchiveProject(id);
  const unarchive = useUnarchiveProject(id);
  const addMember = useAddMember(id);
  const removeMember = useRemoveMember(id);
  const addComment = useAddProjectComment(id);
  const addResource = useAddResource(id);
  const removeResource = useRemoveResource(id);

  const canManageMembers = can("projetos:membros:gerenciar");
  const directory = useQuery({ queryKey: ["projetos", "directory"], queryFn: listDirectoryUsers, enabled: canManageMembers });

  const [newMember, setNewMember] = useState("");
  const [comment, setComment] = useState("");
  const [resDesc, setResDesc] = useState("");
  const [resCost, setResCost] = useState("");
  const [tab, setTab] = useState(0);
  const [openTask, setOpenTask] = useState<string | null>(taskId ?? null);

  if (isLoading || !project) {
    return <Box sx={{ display: "grid", placeItems: "center", height: 200 }}><CircularProgress /></Box>;
  }

  const archived = project.status === "arquivado";

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Box>
          <Typography variant="h5">{project.name}</Typography>
          {project.description && <Typography color="text.secondary">{project.description}</Typography>}
        </Box>
        <Stack direction="row" spacing={1} alignItems="center">
          <Chip label={archived ? "Arquivado" : "Ativo"} color={archived ? "default" : "success"} />
          <Button size="small" startIcon={<PictureAsPdfIcon />} onClick={() => void downloadProjectReport(id)}>
            Relatório
          </Button>
          {can("projetos:projeto:arquivar") && !archived && (
            <Button size="small" startIcon={<ArchiveIcon />} onClick={() => archive.mutate()}>Arquivar</Button>
          )}
          {can("projetos:projeto:arquivar") && archived && (
            <Button size="small" startIcon={<UnarchiveIcon />} onClick={() => unarchive.mutate()}>Desarquivar</Button>
          )}
        </Stack>
      </Stack>

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 4 }}>
          <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
            <Typography variant="h6" gutterBottom>Resumo</Typography>
            <Stack spacing={0.5}>
              <Typography variant="body2">Prazo: {project.due_date ? new Date(project.due_date).toLocaleDateString("pt-BR") : "—"}</Typography>
              <Typography variant="body2">Valor/hora: {brl(project.hourly_rate)}</Typography>
              <Typography variant="body2">Tempo total: {fmtMinutes(project.totals.total_minutes)}</Typography>
              <Typography variant="body2">Custo mão de obra: {brl(project.totals.labor_cost)}</Typography>
              <Typography variant="body2">Custo recursos: {brl(project.totals.resource_cost)}</Typography>
              <Typography variant="subtitle2">Custo total: {brl(project.totals.total_cost)}</Typography>
            </Stack>
          </Paper>

          {project.detail && (
            <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
              <Typography variant="h6" gutterBottom>Descritivo</Typography>
              <Typography variant="body2" whiteSpace="pre-wrap">{project.detail}</Typography>
            </Paper>
          )}

          <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
            <Typography variant="h6" gutterBottom>Membros</Typography>
            <List dense>
              {project.members.map((m) => (
                <ListItem
                  key={m.user_id}
                  disableGutters
                  secondaryAction={
                    canManageMembers && m.user_id !== project.owner_user_id ? (
                      <IconButton size="small" aria-label="remover" onClick={() => removeMember.mutate(m.user_id)}>
                        <PersonRemoveIcon fontSize="small" />
                      </IconButton>
                    ) : undefined
                  }
                >
                  <ListItemText primary={m.full_name ?? m.email} secondary={m.user_id === project.owner_user_id ? "Dono" : m.email} />
                </ListItem>
              ))}
            </List>
            {canManageMembers && (
              <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                <TextField select size="small" fullWidth label="Adicionar membro" value={newMember} onChange={(e) => setNewMember(e.target.value)}>
                  <MenuItem value="">Selecione…</MenuItem>
                  {(directory.data ?? []).filter((u) => !project.members.some((m) => m.user_id === u.id)).map((u) => (
                    <MenuItem key={u.id} value={u.id}>{u.full_name ?? u.email}</MenuItem>
                  ))}
                </TextField>
                <Button variant="outlined" disabled={!newMember || addMember.isPending} onClick={() => { addMember.mutate(newMember); setNewMember(""); }}>Add</Button>
              </Stack>
            )}
          </Paper>

          <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
            <Typography variant="h6" gutterBottom>Recursos e custos</Typography>
            <List dense>
              {project.resources.map((r) => (
                <ListItem
                  key={r.id}
                  disableGutters
                  secondaryAction={can("projetos:projeto:editar") ? (
                    <IconButton size="small" aria-label="remover" onClick={() => removeResource.mutate(r.id)}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  ) : undefined}
                >
                  <ListItemText primary={r.description} secondary={brl(r.cost)} />
                </ListItem>
              ))}
              {project.resources.length === 0 && <Typography variant="caption" color="text.secondary">Nenhum recurso.</Typography>}
            </List>
            {can("projetos:projeto:editar") && (
              <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                <TextField size="small" fullWidth label="Descrição" value={resDesc} onChange={(e) => setResDesc(e.target.value)} />
                <TextField size="small" sx={{ width: 120 }} type="number" label="R$" value={resCost} onChange={(e) => setResCost(e.target.value)} />
                <Button
                  variant="outlined"
                  disabled={!resDesc.trim() || addResource.isPending}
                  onClick={() => { addResource.mutate({ description: resDesc.trim(), cost: Number(resCost) || 0 }); setResDesc(""); setResCost(""); }}
                >
                  Add
                </Button>
              </Stack>
            )}
          </Paper>

          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="h6" gutterBottom>Comentários do projeto</Typography>
            <List dense>
              {project.comments.map((c) => (
                <ListItem key={c.id} disableGutters>
                  <ListItemText primary={c.body} secondary={`${c.author_name ?? "—"} — ${new Date(c.created_at).toLocaleString("pt-BR")}`} />
                </ListItem>
              ))}
              {project.comments.length === 0 && <Typography variant="caption" color="text.secondary">Sem comentários.</Typography>}
            </List>
            {can("projetos:comentario:criar") && (
              <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                <TextField size="small" fullWidth placeholder="Comentar no projeto…" value={comment} onChange={(e) => setComment(e.target.value)} />
                <Button variant="outlined" disabled={!comment.trim() || addComment.isPending} onClick={() => { addComment.mutate(comment.trim()); setComment(""); }}>Enviar</Button>
              </Stack>
            )}
          </Paper>
        </Grid>

        <Grid size={{ xs: 12, md: 8 }}>
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Tabs value={tab} onChange={(_e, v) => setTab(v)} sx={{ mb: 2 }}>
              <Tab label="Kanban" />
              <Tab label="Gantt" />
            </Tabs>
            {tab === 0 ? (
              <ProjectBoard
                projectId={id}
                archived={archived}
                warnDays={project.warn_days}
                members={project.members}
                onOpenTask={(t) => { setOpenTask(t); navigate(`/projetos/${id}/tarefas/${t}`); }}
              />
            ) : (
              <GanttChart projectId={id} projectDue={project.due_date} />
            )}
          </Paper>
        </Grid>
      </Grid>

      <Divider sx={{ my: 2 }} />

      <TaskDetailDialog
        taskId={openTask}
        projectId={id}
        members={project.members}
        onClose={() => { setOpenTask(null); navigate(`/projetos/${id}`); }}
      />
    </Box>
  );
}
