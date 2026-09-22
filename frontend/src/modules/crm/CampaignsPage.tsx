/**
 * @file CampaignsPage.tsx
 * @module modules/crm
 *
 * Campanhas: lista, criação/edição (segmentação por etiquetas e disparo
 * multicanal Email/WhatsApp/SMS) e disparo. Editor conforme a especificação:
 * nome, etiquetas, canais, status, assunto, formato do conteúdo e corpo com
 * variáveis ({{nome_lead}}).
 */

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Box, Typography, Button, Card, CardContent, Stack, Chip, Dialog, DialogTitle,
  DialogContent, DialogActions, TextField, Alert, CircularProgress, ToggleButton,
  ToggleButtonGroup, MenuItem, Divider, FormControlLabel, Switch,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import SendIcon from "@mui/icons-material/Send";
import EditIcon from "@mui/icons-material/Edit";
import {
  listCampaigns, createCampaign, updateCampaign, dispatchCampaign, listCrmItems,
} from "../../core/api/crm-extra.js";
import { listCustomFieldDefs } from "../../core/api/contacts.js";
import { ApiError } from "../../core/api/client.js";
import type { Campaign } from "../../core/api/types.js";

/** Variáveis fixas disponíveis para personalização (token + rótulo). */
const TEMPLATE_VARS: { token: string; label: string }[] = [
  { token: "nome_lead", label: "Nome do contato" },
  { token: "primeiro_nome", label: "Primeiro nome" },
  { token: "empresa_lead", label: "Empresa" },
  { token: "email_lead", label: "E-mail" },
  { token: "telefone_lead", label: "Telefone" },
  { token: "vendedor", label: "Vendedor" },
  { token: "produto", label: "Produto" },
];

/** Converte um ISO (ou null) para o formato de `<input type="datetime-local">`. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const CHANNELS = [
  { id: "email" as const, label: "Email" },
  { id: "whatsapp" as const, label: "WhatsApp" },
  { id: "sms" as const, label: "SMS" },
];
const STATUS_LABELS: Record<Campaign["status"], string> = { draft: "Rascunho", active: "Ativa", paused: "Pausada" };

/**
 * Página de campanhas do CRM.
 *
 * @returns A tela de campanhas.
 */
export function CampaignsPage(): JSX.Element {
  const qc = useQueryClient();
  const { data: campaigns, isLoading } = useQuery({ queryKey: ["crm", "campaigns"], queryFn: listCampaigns });
  const [editing, setEditing] = useState<Campaign | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const dispatch = useMutation({
    mutationFn: (c: Campaign) => dispatchCampaign(c.id, (c.channels[0] as "email" | "whatsapp" | "sms") ?? "email", []),
    onSuccess: (r) => setInfo(`Disparo: ${r.delivered} entregue(s), ${r.failed} falha(s) de ${r.lead_count} contato(s).`),
    onError: (e) => setError(e instanceof ApiError ? e.message : "Falha ao disparar (defina um público por etiquetas)."),
  });

  if (isLoading) {
    return <Box sx={{ display: "grid", placeItems: "center", height: 200 }}><CircularProgress /></Box>;
  }

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Typography variant="h5">Campanhas</Typography>
        <Button startIcon={<AddIcon />} variant="contained" onClick={() => setCreating(true)}>Nova campanha</Button>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
      {info && <Alert severity="info" sx={{ mb: 2 }} onClose={() => setInfo(null)}>{info}</Alert>}

      <Stack spacing={1.5}>
        {(campaigns ?? []).map((c) => (
          <Card key={c.id} variant="outlined">
            <CardContent>
              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Box>
                  <Typography variant="subtitle1" fontWeight={600}>{c.name}</Typography>
                  <Stack direction="row" spacing={0.5} sx={{ mt: 0.5, flexWrap: "wrap", gap: 0.5 }}>
                    {c.tags.map((t) => <Chip key={t} label={t} size="small" />)}
                    <Chip
                      label={STATUS_LABELS[c.status]}
                      size="small"
                      color={c.status === "active" ? "success" : c.status === "paused" ? "warning" : "default"}
                    />
                    {c.channels.map((ch) => <Chip key={ch} label={ch} size="small" variant="outlined" />)}
                  </Stack>
                </Box>
                <Stack direction="row" spacing={1}>
                  <Button startIcon={<EditIcon />} onClick={() => setEditing(c)}>Editar</Button>
                  <Button startIcon={<SendIcon />} variant="outlined" onClick={() => dispatch.mutate(c)} disabled={dispatch.isPending}>Disparar</Button>
                </Stack>
              </Stack>
            </CardContent>
          </Card>
        ))}
        {(campaigns ?? []).length === 0 && <Typography color="text.secondary">Nenhuma campanha ainda.</Typography>}
      </Stack>

      {(creating || editing) && (
        <CampaignEditor
          campaign={editing}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={() => { qc.invalidateQueries({ queryKey: ["crm", "campaigns"] }); setCreating(false); setEditing(null); }}
          onError={setError}
        />
      )}
    </Box>
  );
}

/** Editor de campanha (criação e edição). */
function CampaignEditor({
  campaign, onClose, onSaved, onError,
}: {
  campaign: Campaign | null;
  onClose: () => void;
  onSaved: () => void;
  onError: (m: string) => void;
}): JSX.Element {
  const { data: tagItems } = useQuery({ queryKey: ["crm", "list", "tag"], queryFn: () => listCrmItems("tag") });

  const [name, setName] = useState(campaign?.name ?? "");
  const [tags, setTags] = useState<string[]>(campaign?.tags ?? []);
  const [channels, setChannels] = useState<("email" | "whatsapp" | "sms")[]>(
    (campaign?.channels as ("email" | "whatsapp" | "sms")[]) ?? ["email"],
  );
  const [status, setStatus] = useState<Campaign["status"]>(campaign?.status ?? "draft");
  const [subject, setSubject] = useState(campaign?.subject ?? "");
  const [bodyType, setBodyType] = useState<"text" | "html">(campaign?.body_type ?? "text");
  const [body, setBody] = useState(campaign?.body_text ?? "");
  const [bodyHtml, setBodyHtml] = useState(campaign?.body_html ?? "");

  // Agendamento e throttling.
  const [autoDispatch, setAutoDispatch] = useState(campaign?.auto_dispatch ?? false);
  const [scheduledAt, setScheduledAt] = useState(toLocalInput(campaign?.scheduled_at ?? null));
  const [batchSize, setBatchSize] = useState(String(campaign?.batch_size ?? 50));
  const [perHour, setPerHour] = useState(campaign?.per_hour != null ? String(campaign.per_hour) : "");

  useEffect(() => { /* mantém o editor controlado pela campanha selecionada */ }, [campaign]);

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        name, tags, channels, subject: subject || undefined,
        body_type: bodyType,
        body_text: bodyType === "text" ? body : undefined,
        body_html: bodyType === "html" ? bodyHtml : undefined,
        auto_dispatch: autoDispatch,
        scheduled_at: scheduledAt ? new Date(scheduledAt).toISOString() : null,
        batch_size: Number(batchSize) || 50,
        per_hour: perHour.trim() === "" ? null : Number(perHour),
      };
      return campaign
        ? updateCampaign(campaign.id, { ...payload, status })
        : createCampaign(payload);
    },
    onSuccess: onSaved,
    onError: (e) => onError(e instanceof ApiError ? e.message : "Falha ao salvar campanha."),
  });

  /** Insere uma variável no fim do corpo ativo. */
  function insertVar(token: string): void {
    const chunk = `{{${token}}}`;
    if (bodyType === "html" && channels.includes("email")) setBodyHtml((v) => `${v}${chunk}`);
    else setBody((v) => `${v}${chunk}`);
  }

  function toggleTag(tag: string): void {
    setTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  }

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>
        {campaign ? "Editar campanha" : "Nova campanha"}
        <Typography variant="body2" color="text.secondary">Segmentação por etiquetas e disparo multicanal</Typography>
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2.5} sx={{ mt: 1 }}>
          <TextField label="Nome da campanha" value={name} onChange={(e) => setName(e.target.value)} required fullWidth />

          <Box>
            <Typography variant="subtitle2" gutterBottom>Disparar apenas para leads com as etiquetas</Typography>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              {(tagItems ?? []).map((t) => (
                <Chip
                  key={t.id}
                  label={t.value}
                  color={tags.includes(t.value) ? "primary" : "default"}
                  variant={tags.includes(t.value) ? "filled" : "outlined"}
                  onClick={() => toggleTag(t.value)}
                />
              ))}
              {(tagItems ?? []).length === 0 && <Typography variant="caption" color="text.secondary">Cadastre etiquetas em Configurações.</Typography>}
            </Stack>
          </Box>

          <Box>
            <Typography variant="subtitle2" gutterBottom>Canais de disparo</Typography>
            <Stack direction="row" spacing={2} alignItems="center">
              <ToggleButtonGroup
                value={channels}
                onChange={(_e, v: ("email" | "whatsapp" | "sms")[]) => v.length && setChannels(v)}
              >
                {CHANNELS.map((ch) => <ToggleButton key={ch.id} value={ch.id}>{ch.label}</ToggleButton>)}
              </ToggleButtonGroup>
              <TextField select size="small" label="Status" value={status} onChange={(e) => setStatus(e.target.value as Campaign["status"])} sx={{ width: 160 }}>
                <MenuItem value="draft">Rascunho</MenuItem>
                <MenuItem value="active">Ativa</MenuItem>
                <MenuItem value="paused">Pausada</MenuItem>
              </TextField>
            </Stack>
          </Box>

          <Divider />
          <Box>
            <Typography variant="subtitle2" gutterBottom>Agendamento e ritmo de disparo</Typography>
            <FormControlLabel
              control={<Switch checked={autoDispatch} onChange={(e) => setAutoDispatch(e.target.checked)} />}
              label="Disparar automaticamente após o cadastro"
            />
            <Stack direction="row" spacing={2} sx={{ mt: 1 }} flexWrap="wrap" useFlexGap>
              <TextField
                type="datetime-local"
                size="small"
                label="Iniciar em (opcional)"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                InputLabelProps={{ shrink: true }}
                disabled={!autoDispatch}
                sx={{ width: 220 }}
                helperText="Em branco = imediato"
              />
              <TextField
                type="number"
                size="small"
                label="Mensagens por vez"
                value={batchSize}
                onChange={(e) => setBatchSize(e.target.value)}
                disabled={!autoDispatch}
                sx={{ width: 160 }}
                inputProps={{ min: 1 }}
              />
              <TextField
                type="number"
                size="small"
                label="Máx. por hora"
                value={perHour}
                onChange={(e) => setPerHour(e.target.value)}
                disabled={!autoDispatch}
                sx={{ width: 160 }}
                inputProps={{ min: 1 }}
                helperText="Em branco = sem limite"
              />
            </Stack>
          </Box>

          {channels.includes("email") && (
            <>
              <Box>
                <TextField label="Assunto do email" value={subject} onChange={(e) => setSubject(e.target.value)} fullWidth />
                <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
                  <Typography variant="caption" color="text.secondary" sx={{ alignSelf: "center", mr: 0.5 }}>Inserir no assunto:</Typography>
                  {TEMPLATE_VARS.map((v) => (
                    <Chip key={v.token} size="small" variant="outlined" label={v.label} onClick={() => setSubject((s) => `${s}{{${v.token}}}`)} />
                  ))}
                </Stack>
              </Box>
              <Box>
                <Typography variant="subtitle2" gutterBottom>Formato do conteúdo do email</Typography>
                <ToggleButtonGroup exclusive value={bodyType} onChange={(_e, v) => v && setBodyType(v)}>
                  <ToggleButton value="text">✏️ Texto comum</ToggleButton>
                  <ToggleButton value="html">🖥️ HTML (código-fonte)</ToggleButton>
                </ToggleButtonGroup>
              </Box>
            </>
          )}

          <Divider />
          <Box>
            <Typography variant="subtitle2" gutterBottom>
              {bodyType === "html" && channels.includes("email") ? "Corpo do email (HTML)" : "Corpo da mensagem"}
            </Typography>
            <VariablePalette onInsert={insertVar} />
            <TextField
              multiline minRows={5} fullWidth
              value={bodyType === "html" && channels.includes("email") ? bodyHtml : body}
              onChange={(e) => (bodyType === "html" && channels.includes("email") ? setBodyHtml(e.target.value) : setBody(e.target.value))}
              placeholder="Olá {{nome_lead}}, ..."
              helperText="Clique nas variáveis acima para inseri-las. Os valores são preenchidos por contato no disparo."
              sx={{ mt: 1 }}
            />
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancelar</Button>
        <Button variant="contained" onClick={() => save.mutate()} disabled={save.isPending || !name}>
          {save.isPending ? "Salvando…" : "Salvar"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/**
 * Paleta de variáveis para inserção no corpo da mensagem. Mostra as variáveis
 * fixas do contato/lead e, dinamicamente, os campos personalizados cadastrados
 * (como `{{campo_<nome>}}`).
 */
function VariablePalette({ onInsert }: { onInsert: (token: string) => void }): JSX.Element {
  const { data: defs } = useQuery({ queryKey: ["custom-fields", "contact"], queryFn: () => listCustomFieldDefs("contact") });

  return (
    <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
      <Typography variant="caption" color="text.secondary" sx={{ alignSelf: "center", mr: 0.5 }}>Variáveis:</Typography>
      {TEMPLATE_VARS.map((v) => (
        <Chip key={v.token} size="small" label={v.label} onClick={() => onInsert(v.token)} />
      ))}
      {(defs ?? []).map((d) => (
        <Chip key={d.id} size="small" variant="outlined" label={d.name} onClick={() => onInsert(`campo_${d.name}`)} />
      ))}
    </Stack>
  );
}
