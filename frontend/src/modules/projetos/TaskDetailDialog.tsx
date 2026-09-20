/**
 * @file TaskDetailDialog.tsx
 * @module modules/projetos
 *
 * Diálogo de detalhe de tarefa: título/descrição, atribuídos (add/remove),
 * comentários (cronológico + novo) e anexos (upload, download, excluir).
 */

import { useState } from "react";
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Stack, Typography, Divider,
  List, ListItem, ListItemText, IconButton, TextField, Chip, MenuItem, CircularProgress, Link,
} from "@mui/material";
import DeleteIcon from "@mui/icons-material/Delete";
import DownloadIcon from "@mui/icons-material/Download";
import {
  useTask, useAddTaskComment, useAssignTask, useUnassignTask, useUploadAttachment, useDeleteAttachment,
} from "./hooks.js";
import { useCan } from "../../core/rbac/can.js";
import { attachmentUrl, type ProjectMember } from "../../core/api/projetos.js";

/** Props do diálogo. */
interface Props {
  taskId: string | null;
  members: ProjectMember[];
  onClose: () => void;
}

/**
 * Diálogo de detalhe de tarefa.
 *
 * @param props - Tarefa selecionada, membros do projeto e callback de fechar.
 * @returns O diálogo, ou vazio se nenhuma tarefa selecionada.
 */
export function TaskDetailDialog({ taskId, members, onClose }: Props): JSX.Element | null {
  const can = useCan();
  const { data: task, isLoading } = useTask(taskId ?? "");

  const addComment = useAddTaskComment(taskId ?? "");
  const assign = useAssignTask(taskId ?? "");
  const unassign = useUnassignTask(taskId ?? "");
  const upload = useUploadAttachment(taskId ?? "");
  const removeAttachment = useDeleteAttachment(taskId ?? "");

  const [comment, setComment] = useState("");
  const [assignee, setAssignee] = useState("");

  if (!taskId) return null;

  const canComment = can("projetos:comentario:criar");
  const canAssign = can("projetos:tarefa:atribuir");
  const canUpload = can("projetos:anexo:enviar");
  const canDeleteAtt = can("projetos:anexo:excluir");

  const memberName = (id: string): string => members.find((m) => m.user_id === id)?.full_name ?? id;

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      {isLoading || !task ? (
        <DialogContent><CircularProgress /></DialogContent>
      ) : (
        <>
          <DialogTitle>{task.title}</DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ mt: 1 }}>
              {task.description && <Typography variant="body2">{task.description}</Typography>}

              <Divider textAlign="left"><Typography variant="caption">Atribuídos</Typography></Divider>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                {task.assignees.length === 0 && <Typography variant="caption" color="text.secondary">Ninguém atribuído.</Typography>}
                {task.assignees.map((uid) => (
                  <Chip
                    key={uid}
                    label={memberName(uid)}
                    {...(canAssign ? { onDelete: () => unassign.mutate(uid) } : {})}
                  />
                ))}
              </Stack>
              {canAssign && (
                <Stack direction="row" spacing={1}>
                  <TextField
                    select size="small" fullWidth label="Atribuir a"
                    value={assignee}
                    onChange={(e) => setAssignee(e.target.value)}
                  >
                    <MenuItem value="">Selecione…</MenuItem>
                    {members
                      .filter((m) => !task.assignees.includes(m.user_id))
                      .map((m) => <MenuItem key={m.user_id} value={m.user_id}>{m.full_name ?? m.email}</MenuItem>)}
                  </TextField>
                  <Button
                    variant="outlined"
                    disabled={!assignee || assign.isPending}
                    onClick={() => { assign.mutate(assignee); setAssignee(""); }}
                  >
                    Atribuir
                  </Button>
                </Stack>
              )}

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
                    <ListItemText primary={a.original_name} secondary={`${(a.size_bytes / 1024).toFixed(1)} KB`} />
                  </ListItem>
                ))}
                {task.attachments.length === 0 && <Typography variant="caption" color="text.secondary">Sem anexos.</Typography>}
              </List>
              {canUpload && (
                <Button variant="outlined" component="label" disabled={upload.isPending}>
                  Enviar anexo
                  <input
                    type="file"
                    hidden
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) upload.mutate(f);
                      e.target.value = "";
                    }}
                  />
                </Button>
              )}

              <Divider textAlign="left"><Typography variant="caption">Comentários</Typography></Divider>
              <List dense>
                {task.comments.map((c) => (
                  <ListItem key={c.id} disableGutters>
                    <ListItemText
                      primary={c.body}
                      secondary={`${c.author_name ?? "—"} — ${new Date(c.created_at).toLocaleString("pt-BR")}`}
                    />
                  </ListItem>
                ))}
                {task.comments.length === 0 && <Typography variant="caption" color="text.secondary">Sem comentários.</Typography>}
              </List>
              {canComment && (
                <Stack direction="row" spacing={1}>
                  <TextField
                    size="small" fullWidth placeholder="Adicionar comentário…"
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                  />
                  <Button
                    variant="outlined"
                    disabled={!comment.trim() || addComment.isPending}
                    onClick={() => { addComment.mutate(comment.trim()); setComment(""); }}
                  >
                    Enviar
                  </Button>
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
