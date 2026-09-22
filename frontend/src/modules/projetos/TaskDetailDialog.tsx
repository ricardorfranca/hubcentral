/**
 * @file TaskDetailDialog.tsx
 * @module modules/projetos
 *
 * Diálogo de detalhe de tarefa (2.0): título/descrição, prazo, responsável
 * único, visibilidade, dependência, comentários (com apontamento de tempo em
 * horas/minutos) e anexos. Mostra o total de tempo apontado.
 */

import { useState } from "react";
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Stack, Typography, Divider,
  List, ListItem, ListItemText, IconButton, TextField, MenuItem, CircularProgress, Link,
  FormControlLabel, Switch, Chip, Box,
} from "@mui/material";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import DownloadIcon from "@mui/icons-material/Download";
import {
  useTask, useAddTaskComment, useSetAssignee, useUpdateTask, useUploadAttachment, useDeleteAttachment, useTasks,
} from "./hooks.js";
import { useCan } from "../../core/rbac/can.js";
import { attachmentUrl, type ProjectMember } from "../../core/api/projetos.js";
import { fmtMinutes } from "./format.js";
import { CustomFieldsEditor } from "../../core/ui/CustomFieldsEditor.js";

/** Props do diálogo. */
interface Props {
  taskId: string | null;
  projectId: string;
  members: ProjectMember[];
  onClose: () => void;
}

/**
 * Diálogo de detalhe de tarefa.
 *
 * @param props - Tarefa selecionada, projeto, membros e callback de fechar.
 * @returns O diálogo, ou vazio se nenhuma tarefa selecionada.
 */
export function TaskDetailDialog({ taskId, projectId, members, onClose }: Props): JSX.Element | null {
  const can = useCan();
  const { data: task, isLoading } = useTask(taskId ?? "");
  const { data: allTasks } = useTasks(projectId);

  const addComment = useAddTaskComment(taskId ?? "", projectId);
  const setAssignee = useSetAssignee(taskId ?? "", projectId);
  const updateTask = useUpdateTask(taskId ?? "", projectId);
  const upload = useUploadAttachment(taskId ?? "");
  const removeAttachment = useDeleteAttachment(taskId ?? "");

  const [comment, setComment] = useState("");
  const [hours, setHours] = useState("");
  const [minutes, setMinutes] = useState("");

  if (!taskId) return null;

  const canComment = can("projetos:comentario:criar");
  const canAssign = can("projetos:tarefa:atribuir");
  const canEdit = can("projetos:tarefa:editar");
  const canUpload = can("projetos:anexo:enviar");
  const canDeleteAtt = can("projetos:anexo:excluir");

  const memberName = (id: string | null): string => id ? (members.find((m) => m.user_id === id)?.full_name ?? id) : "—";

  function submitComment(): void {
    const totalMin = (Number(hours) || 0) * 60 + (Number(minutes) || 0);
    if (!comment.trim() && totalMin === 0) return;
    addComment.mutate({ body: comment.trim() || "(apontamento de tempo)", minutes: totalMin });
    setComment(""); setHours(""); setMinutes("");
  }

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      {isLoading || !task ? (
        <DialogContent><CircularProgress /></DialogContent>
      ) : (
        <>
          <DialogTitle>{task.title}</DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ mt: 1 }}>
              <TaskDescription
                key={task.id}
                description={task.description}
                canEdit={canEdit}
                onSave={(value) => updateTask.mutate({ description: value })}
                saving={updateTask.isPending}
              />


              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                {task.due_date && <Chip size="small" label={`Prazo: ${new Date(task.due_date).toLocaleDateString("pt-BR")}`} />}
                <Chip size="small" label={`Tempo: ${fmtMinutes(task.minutes_total)}`} />
                {!task.visible_to_all && <Chip size="small" color="warning" label="Visibilidade restrita" />}
              </Stack>

              <Divider textAlign="left"><Typography variant="caption">Responsável</Typography></Divider>
              {canAssign ? (
                <TextField
                  select size="small" fullWidth label="Responsável"
                  value={task.assignee_user_id ?? ""}
                  onChange={(e) => setAssignee.mutate(e.target.value || null)}
                >
                  <MenuItem value="">—</MenuItem>
                  {members.map((m) => <MenuItem key={m.user_id} value={m.user_id}>{m.full_name ?? m.email}</MenuItem>)}
                </TextField>
              ) : (
                <Typography variant="body2">{memberName(task.assignee_user_id)}</Typography>
              )}

              {canEdit && (
                <>
                  <Divider textAlign="left"><Typography variant="caption">Configurações</Typography></Divider>
                  <Stack direction="row" spacing={2}>
                    <TextField
                      label="Prazo" type="date" size="small" fullWidth
                      value={task.due_date ? task.due_date.slice(0, 10) : ""}
                      onChange={(e) => updateTask.mutate({ due_date: e.target.value })}
                      InputLabelProps={{ shrink: true }}
                    />
                    <TextField
                      select size="small" fullWidth label="Depende de"
                      value={task.depends_on_task_id ?? ""}
                      onChange={(e) => updateTask.mutate({ depends_on_task_id: e.target.value || null })}
                    >
                      <MenuItem value="">Nenhuma</MenuItem>
                      {(allTasks ?? []).filter((t) => t.id !== task.id).map((t) => (
                        <MenuItem key={t.id} value={t.id}>{t.title}</MenuItem>
                      ))}
                    </TextField>
                  </Stack>
                  <FormControlLabel
                    control={<Switch checked={task.visible_to_all} onChange={(e) => updateTask.mutate({ visible_to_all: e.target.checked })} />}
                    label="Visível a todos os participantes do projeto"
                  />
                </>
              )}

              <Divider textAlign="left"><Typography variant="caption">Campos personalizados</Typography></Divider>
              <CustomFieldsEditor entity="projetos_task" entityId={task.id} />

              <Divider textAlign="left"><Typography variant="caption">Anexos</Typography></Divider>
              <List dense>
                {task.attachments.map((a) => (
                  <ListItem
                    key={a.id}
                    secondaryAction={
                      <Stack direction="row" spacing={0.5}>
                        <IconButton component={Link} href={attachmentUrl(a.id)} size="small" aria-label="baixar">
                          <DownloadIcon fontSize="small" />
                        </IconButton>
                        {canDeleteAtt && (
                          <IconButton size="small" aria-label="excluir" onClick={() => removeAttachment.mutate(a.id)}>
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        )}
                      </Stack>
                    }
                  >
                    <ListItemText primary={a.original_name} secondary={`${(a.size_bytes / (1024 * 1024)).toFixed(2)} MB`} />
                  </ListItem>
                ))}
                {task.attachments.length === 0 && <Typography variant="caption" color="text.secondary">Sem anexos.</Typography>}
              </List>
              {canUpload && (
                <Button variant="outlined" component="label" disabled={upload.isPending}>
                  Enviar anexo
                  <input type="file" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate(f); e.target.value = ""; }} />
                </Button>
              )}

              <Divider textAlign="left"><Typography variant="caption">Comentários e apontamentos</Typography></Divider>
              <List dense>
                {task.comments.map((c) => (
                  <ListItem key={c.id} disableGutters>
                    <ListItemText
                      primary={c.body}
                      secondary={
                        `${c.author_name ?? "—"} — ${new Date(c.created_at).toLocaleString("pt-BR")}` +
                        ((c.minutes ?? 0) > 0 ? ` · ${fmtMinutes(c.minutes)}` : "")
                      }
                    />
                  </ListItem>
                ))}
                {task.comments.length === 0 && <Typography variant="caption" color="text.secondary">Sem comentários.</Typography>}
              </List>
              {canComment && (
                <Stack spacing={1}>
                  <TextField
                    size="small" fullWidth placeholder="Adicionar comentário…" multiline maxRows={4}
                    value={comment} onChange={(e) => setComment(e.target.value)}
                  />
                  <Stack direction="row" spacing={1} alignItems="center">
                    <TextField size="small" type="number" label="Horas" sx={{ width: 100 }} value={hours} onChange={(e) => setHours(e.target.value)} />
                    <TextField size="small" type="number" label="Minutos" sx={{ width: 100 }} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
                    <Button variant="outlined" onClick={submitComment} disabled={addComment.isPending}>Registrar</Button>
                  </Stack>
                </Stack>
              )}
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={onClose}>Fechar</Button>
          </DialogActions>
        </>
      )}
    </Dialog>
  );
}

/**
 * Bloco de descrição da tarefa: exibe o texto e, para quem pode editar, permite
 * alternar para um campo multilinha e salvar. Mostra um placeholder quando
 * vazia (para quem edita) ou nada (para quem só visualiza).
 *
 * @param props - Descrição atual, permissão de edição, callback de salvar e flag de salvamento.
 * @returns O bloco de descrição.
 */
function TaskDescription({
  description, canEdit, onSave, saving,
}: {
  description: string | null;
  canEdit: boolean;
  onSave: (value: string) => void;
  saving: boolean;
}): JSX.Element | null {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(description ?? "");

  if (editing) {
    return (
      <Box>
        <Typography variant="caption" color="text.secondary">Descrição</Typography>
        <TextField
          fullWidth multiline minRows={3} size="small" autoFocus
          value={text} onChange={(e) => setText(e.target.value)}
          placeholder="Descreva a tarefa…" sx={{ mt: 0.5 }}
        />
        <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
          <Button size="small" variant="contained" disabled={saving} onClick={() => { onSave(text.trim()); setEditing(false); }}>
            Salvar descrição
          </Button>
          <Button size="small" onClick={() => { setText(description ?? ""); setEditing(false); }}>Cancelar</Button>
        </Stack>
      </Box>
    );
  }

  // Sem descrição e sem permissão de edição: não ocupa espaço.
  if (!description && !canEdit) return null;

  return (
    <Box>
      <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={1}>
        {description ? (
          <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", flexGrow: 1 }}>{description}</Typography>
        ) : (
          <Typography variant="body2" color="text.secondary" fontStyle="italic" sx={{ flexGrow: 1 }}>
            Sem descrição.
          </Typography>
        )}
        {canEdit && (
          <IconButton size="small" aria-label="editar descrição" onClick={() => { setText(description ?? ""); setEditing(true); }}>
            <EditIcon fontSize="small" />
          </IconButton>
        )}
      </Stack>
    </Box>
  );
}
