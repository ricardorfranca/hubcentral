/**
 * @file OpportunityDetailPage.tsx
 * @module modules/crm
 *
 * Detalhe de oportunidade: valores (MRR/ARR/único), estágio atual com troca,
 * finalização (ganho/perdido) e cadência de atividades.
 */

import { useState } from "react";
import { useParams } from "react-router-dom";
import {
  Box, Typography, Paper, Grid2 as Grid, Stack, Chip, Button, TextField, MenuItem,
  List, ListItem, ListItemText, Divider, CircularProgress, Alert, Dialog, DialogTitle,
  DialogContent, DialogActions, Checkbox,
} from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import {
  useOpportunity, useStages, useMoveStage, useFinalizeOpportunity,
  useOpportunityActivities, useCreateActivity, useCompleteActivity,
} from "./sales-hooks.js";
import { useCan } from "../../core/rbac/can.js";
import { brl, dateTime, ACTIVITY_LABELS, ORIGIN_LABELS, QUALIFICATION_LABELS } from "./format.js";
import type { Activity } from "../../core/api/crm-sales.js";
import { ApiError } from "../../core/api/client.js";

/**
 * Página de detalhe de uma oportunidade.
 *
 * @returns A tela de detalhe.
 */
export function OpportunityDetailPage(): JSX.Element {
  const { id = "" } = useParams();
  const can = useCan();
  const { data: opp, isLoading } = useOpportunity(id);
  const { data: stages } = useStages();
  const moveStage = useMoveStage();
  const finalize = useFinalizeOpportunity();
  const activities = useOpportunityActivities(id);

  const [finalizeOpen, setFinalizeOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);

  if (isLoading || !opp) {
    return <Box sx={{ display: "grid", placeItems: "center", height: 200 }}><CircularProgress /></Box>;
  }

  const isOpen = opp.status === "open";
  const canMove = can("crm:oportunidades:mover");
  const canFinalize = can("crm:oportunidades:finalizar");
  const canActivities = can("crm:atividades:gerenciar");

  const arr = opp.arr ?? Number(opp.mrr) * 12;
  const currentStage = (stages ?? []).find((s) => s.id === opp.stage_id);

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Box>
          <Typography variant="h5">{opp.name}</Typography>
          {opp.account_name && <Typography color="text.secondary">{opp.account_name}</Typography>}
        </Box>
        <Chip
          label={opp.status === "won" ? "Ganho" : opp.status === "lost" ? "Perdido" : "Aberta"}
          color={opp.status === "won" ? "success" : opp.status === "lost" ? "error" : "default"}
        />
      </Stack>

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 8 }}>
          <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
            <Typography variant="h6" gutterBottom>Receita</Typography>
            <Grid container spacing={2}>
              <Grid size={4}>
                <Typography variant="overline" color="text.secondary">MRR</Typography>
                <Typography variant="h6">{brl(opp.mrr)}</Typography>
              </Grid>
              <Grid size={4}>
                <Typography variant="overline" color="text.secondary">ARR</Typography>
                <Typography variant="h6">{brl(arr)}</Typography>
              </Grid>
              <Grid size={4}>
                <Typography variant="overline" color="text.secondary">Valor único</Typography>
                <Typography variant="h6">{brl(opp.one_time)}</Typography>
              </Grid>
            </Grid>
            <Divider sx={{ my: 2 }} />
            <Stack direction="row" spacing={2} flexWrap="wrap">
              {opp.origin && <Chip label={`Origem: ${ORIGIN_LABELS[opp.origin] ?? opp.origin}`} />}
              {opp.qualification && <Chip label={`Qualificação: ${QUALIFICATION_LABELS[opp.qualification] ?? opp.qualification}`} />}
              <Chip label={`Probabilidade: ${opp.probability}%`} />
            </Stack>
            {opp.status === "lost" && opp.loss_reason && (
              <Alert severity="warning" sx={{ mt: 2 }}>Motivo da perda: {opp.loss_reason}</Alert>
            )}
          </Paper>

          <Paper variant="outlined" sx={{ p: 2 }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
              <Typography variant="h6">Atividades</Typography>
              {canActivities && isOpen && (
                <Button size="small" onClick={() => setActivityOpen(true)}>Nova atividade</Button>
              )}
            </Stack>
            {activities.isLoading ? (
              <CircularProgress size={20} />
            ) : (
              <List dense>
                {(activities.data ?? []).map((a) => (
                  <ActivityRow key={a.id} activity={a} canComplete={canActivities} />
                ))}
                {(activities.data ?? []).length === 0 && (
                  <Typography color="text.secondary">Sem atividades registradas.</Typography>
                )}
              </List>
            )}
          </Paper>
        </Grid>

        <Grid size={{ xs: 12, md: 4 }}>
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="h6" gutterBottom>Estágio</Typography>
            <TextField
              select
              fullWidth
              size="small"
              value={opp.stage_id}
              disabled={!canMove || !isOpen}
              onChange={(e) => moveStage.mutate({ id: opp.id, stageId: e.target.value })}
              helperText={currentStage?.terminal ? "Estágio terminal" : undefined}
            >
              {(stages ?? []).filter((s) => !s.terminal).map((s) => (
                <MenuItem key={s.id} value={s.id}>{s.label} ({s.probability}%)</MenuItem>
              ))}
            </TextField>

            {isOpen && canFinalize && (
              <Button
                fullWidth
                variant="contained"
                sx={{ mt: 2 }}
                onClick={() => setFinalizeOpen(true)}
              >
                Finalizar oportunidade
              </Button>
            )}
          </Paper>
        </Grid>
      </Grid>

      <FinalizeDialog
        open={finalizeOpen}
        onClose={() => setFinalizeOpen(false)}
        opportunityId={opp.id}
        defaultMrr={opp.mrr}
        defaultOneTime={opp.one_time}
        finalize={finalize}
      />
      <NewActivityDialog
        open={activityOpen}
        onClose={() => setActivityOpen(false)}
        opportunityId={opp.id}
      />
    </Box>
  );
}

/** Linha de atividade com ação de concluir. */
function ActivityRow({ activity, canComplete }: { activity: Activity; canComplete: boolean }): JSX.Element {
  const complete = useCompleteActivity();
  const done = activity.status === "concluida";
  return (
    <ListItem
      secondaryAction={
        !done && canComplete ? (
          <Checkbox
            icon={<CheckCircleIcon color="disabled" />}
            checkedIcon={<CheckCircleIcon color="success" />}
            onChange={() => complete.mutate(activity.id)}
            disabled={complete.isPending}
          />
        ) : done ? <CheckCircleIcon color="success" /> : undefined
      }
    >
      <ListItemText
        primary={`${ACTIVITY_LABELS[activity.type] ?? activity.type}: ${activity.subject}`}
        secondary={
          <>
            {activity.notes ? `${activity.notes} · ` : ""}
            {activity.due_at ? `Prazo: ${dateTime(activity.due_at)}` : "Sem prazo"}
          </>
        }
        sx={{ textDecoration: done ? "line-through" : "none" }}
      />
    </ListItem>
  );
}

/** Diálogo de finalização (ganho/perdido). */
function FinalizeDialog({
  open, onClose, opportunityId, defaultMrr, defaultOneTime, finalize,
}: {
  open: boolean;
  onClose: () => void;
  opportunityId: string;
  defaultMrr: string;
  defaultOneTime: string;
  finalize: ReturnType<typeof useFinalizeOpportunity>;
}): JSX.Element {
  const [outcome, setOutcome] = useState<"won" | "lost">("won");
  const [mrr, setMrr] = useState(defaultMrr);
  const [oneTime, setOneTime] = useState(defaultOneTime);
  const [lossReason, setLossReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit(): Promise<void> {
    setError(null);
    if (outcome === "lost" && !lossReason.trim()) {
      setError("Informe o motivo da perda.");
      return;
    }
    try {
      await finalize.mutateAsync({
        id: opportunityId,
        outcome,
        extra: outcome === "won"
          ? { mrr: Number(mrr), one_time: Number(oneTime) }
          : { loss_reason: lossReason.trim() },
      });
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Falha ao finalizar.");
    }
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Finalizar oportunidade</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField select label="Resultado" value={outcome} onChange={(e) => setOutcome(e.target.value as "won" | "lost")}>
            <MenuItem value="won">Ganho</MenuItem>
            <MenuItem value="lost">Perdido</MenuItem>
          </TextField>
          {outcome === "won" ? (
            <>
              <TextField label="MRR final" type="number" value={mrr} onChange={(e) => setMrr(e.target.value)} InputProps={{ startAdornment: "R$ " }} />
              <TextField label="Valor único final" type="number" value={oneTime} onChange={(e) => setOneTime(e.target.value)} InputProps={{ startAdornment: "R$ " }} />
            </>
          ) : (
            <TextField label="Motivo da perda" value={lossReason} onChange={(e) => setLossReason(e.target.value)} multiline minRows={2} required />
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancelar</Button>
        <Button variant="contained" onClick={submit} disabled={finalize.isPending}>Confirmar</Button>
      </DialogActions>
    </Dialog>
  );
}

/** Diálogo de criação de atividade vinculada à oportunidade. */
function NewActivityDialog({
  open, onClose, opportunityId,
}: {
  open: boolean;
  onClose: () => void;
  opportunityId: string;
}): JSX.Element {
  const create = useCreateActivity();
  const [type, setType] = useState<Activity["type"]>("tarefa");
  const [subject, setSubject] = useState("");
  const [notes, setNotes] = useState("");
  const [dueAt, setDueAt] = useState("");

  async function submit(): Promise<void> {
    if (!subject.trim()) return;
    await create.mutateAsync({
      type,
      subject: subject.trim(),
      notes: notes.trim() || undefined,
      opportunity_id: opportunityId,
      due_at: dueAt || undefined,
    });
    setSubject("");
    setNotes("");
    setDueAt("");
    onClose();
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Nova atividade</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField select label="Tipo" value={type} onChange={(e) => setType(e.target.value as Activity["type"])}>
            {Object.entries(ACTIVITY_LABELS).map(([value, label]) => (
              <MenuItem key={value} value={value}>{label}</MenuItem>
            ))}
          </TextField>
          <TextField label="Assunto" value={subject} onChange={(e) => setSubject(e.target.value)} required />
          <TextField label="Notas" value={notes} onChange={(e) => setNotes(e.target.value)} multiline minRows={2} />
          <TextField
            label="Prazo"
            type="datetime-local"
            value={dueAt}
            onChange={(e) => setDueAt(e.target.value)}
            InputLabelProps={{ shrink: true }}
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
