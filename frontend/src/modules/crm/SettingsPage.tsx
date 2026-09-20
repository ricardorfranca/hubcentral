/**
 * @file SettingsPage.tsx
 * @module modules/crm
 *
 * Tela de configurações do CRM: gestão de listas configuráveis (por tipo) e
 * SLA por etapa do pipeline.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Box, Typography, Card, CardContent, Grid2 as Grid, Stack, TextField, Button, Chip,
  Select, MenuItem, FormControl, InputLabel,
} from "@mui/material";
import { addCrmItem, listCrmItems, getSla, setSla, type CrmListType } from "../../core/api/crm-extra.js";
import { useStages } from "./sales-hooks.js";
import type { SlaConfig } from "../../core/api/types.js";

const LIST_TYPES: { type: CrmListType; label: string }[] = [
  { type: "tag", label: "Etiquetas" },
  { type: "source", label: "Origens" },
  { type: "product", label: "Produtos" },
  { type: "partner", label: "Parceiros" },
  { type: "loss_reason", label: "Motivos de perda" },
];

/** Editor de uma lista configurável de um tipo. */
function ListEditor({ type, label }: { type: CrmListType; label: string }): JSX.Element {
  const qc = useQueryClient();
  const { data: items } = useQuery({ queryKey: ["crm", "list", type], queryFn: () => listCrmItems(type) });
  const [value, setValue] = useState("");
  const add = useMutation({
    mutationFn: () => addCrmItem(type, value),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["crm", "list", type] });
      setValue("");
    },
  });

  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="subtitle1" fontWeight={600} gutterBottom>{label}</Typography>
        <Stack direction="row" spacing={0.5} sx={{ flexWrap: "wrap", gap: 0.5, mb: 1 }}>
          {(items ?? []).map((i) => <Chip key={i.id} label={i.value} size="small" />)}
          {(items ?? []).length === 0 && <Typography variant="body2" color="text.secondary">Vazio</Typography>}
        </Stack>
        <Stack direction="row" spacing={1}>
          <TextField size="small" fullWidth placeholder={`Novo item de ${label.toLowerCase()}`} value={value} onChange={(e) => setValue(e.target.value)} />
          <Button variant="outlined" onClick={() => value.trim() && add.mutate()} disabled={add.isPending}>Adicionar</Button>
        </Stack>
      </CardContent>
    </Card>
  );
}

/** Editor de SLA de uma etapa. */
function SlaEditor({ columnId, label }: { columnId: string; label: string }): JSX.Element {
  const qc = useQueryClient();
  const { data } = useQuery<SlaConfig | null>({
    queryKey: ["crm", "sla", columnId],
    queryFn: () => getSla(columnId).catch(() => null),
  });
  const [value, setValue] = useState<number>(30);
  const [unit, setUnit] = useState<SlaConfig["unit"]>("minutes");
  const save = useMutation({
    mutationFn: () => setSla(columnId, value, unit),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["crm", "sla", columnId] }),
  });

  return (
    <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
      <Typography sx={{ width: 200 }}>{label}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ width: 120 }}>
        Atual: {data ? `${data.value} ${data.unit}` : "—"}
      </Typography>
      <TextField size="small" type="number" sx={{ width: 100 }} value={value} onChange={(e) => setValue(Number(e.target.value))} />
      <FormControl size="small" sx={{ width: 140 }}>
        <InputLabel>Unidade</InputLabel>
        <Select label="Unidade" value={unit} onChange={(e) => setUnit(e.target.value as SlaConfig["unit"])}>
          <MenuItem value="minutes">minutos</MenuItem>
          <MenuItem value="hours">horas</MenuItem>
          <MenuItem value="days">dias</MenuItem>
        </Select>
      </FormControl>
      <Button variant="outlined" onClick={() => save.mutate()} disabled={save.isPending}>Salvar</Button>
    </Stack>
  );
}

/**
 * Página de configurações do CRM.
 *
 * @returns A tela de configurações.
 */
export function SettingsPage(): JSX.Element {
  const { data: stages } = useStages();
  const activeStages = (stages ?? []).filter((s) => !s.terminal).sort((a, b) => a.position - b.position);

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 2 }}>Configurações do CRM</Typography>

      <Grid container spacing={2} sx={{ mb: 3 }}>
        {LIST_TYPES.map((l) => (
          <Grid key={l.type} size={{ xs: 12, md: 6 }}>
            <ListEditor type={l.type} label={l.label} />
          </Grid>
        ))}
      </Grid>

      <Card variant="outlined">
        <CardContent>
          <Typography variant="h6" gutterBottom>SLA por etapa</Typography>
          {activeStages.map((s) => <SlaEditor key={s.id} columnId={s.id} label={s.label} />)}
        </CardContent>
      </Card>
    </Box>
  );
}
