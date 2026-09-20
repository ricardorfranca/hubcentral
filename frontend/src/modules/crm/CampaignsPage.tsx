/**
 * @file CampaignsPage.tsx
 * @module modules/crm
 *
 * Tela de campanhas: lista, criação e disparo.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Box, Typography, Button, Card, CardContent, Stack, Chip, Dialog, DialogTitle,
  DialogContent, DialogActions, TextField, Alert, CircularProgress,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import SendIcon from "@mui/icons-material/Send";
import { listCampaigns, createCampaign, dispatchCampaign } from "../../core/api/crm-extra.js";
import { ApiError } from "../../core/api/client.js";

/**
 * Página de campanhas do CRM.
 *
 * @returns A tela de campanhas.
 */
export function CampaignsPage(): JSX.Element {
  const qc = useQueryClient();
  const { data: campaigns, isLoading } = useQuery({ queryKey: ["crm", "campaigns"], queryFn: listCampaigns });
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [tags, setTags] = useState("");
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () =>
      createCampaign({
        name,
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
        channels: ["email"],
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["crm", "campaigns"] });
      setOpen(false);
      setName("");
      setTags("");
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Falha ao criar campanha."),
  });

  const dispatch = useMutation({
    mutationFn: (id: string) => dispatchCampaign(id, "email", []),
    onError: (e) => setError(e instanceof ApiError ? e.message : "Falha ao disparar (defina um público)."),
  });

  if (isLoading) {
    return <Box sx={{ display: "grid", placeItems: "center", height: 200 }}><CircularProgress /></Box>;
  }

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Typography variant="h5">Campanhas</Typography>
        <Button startIcon={<AddIcon />} variant="contained" onClick={() => setOpen(true)}>Nova campanha</Button>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

      <Stack spacing={1.5}>
        {(campaigns ?? []).map((c) => (
          <Card key={c.id} variant="outlined">
            <CardContent>
              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Box>
                  <Typography variant="subtitle1" fontWeight={600}>{c.name}</Typography>
                  <Stack direction="row" spacing={0.5} sx={{ mt: 0.5 }}>
                    {c.tags.map((t) => <Chip key={t} label={t} size="small" />)}
                    <Chip label={c.status} size="small" color="default" />
                  </Stack>
                </Box>
                <Button
                  startIcon={<SendIcon />}
                  onClick={() => dispatch.mutate(c.id)}
                  disabled={dispatch.isPending}
                >
                  Disparar
                </Button>
              </Stack>
            </CardContent>
          </Card>
        ))}
        {(campaigns ?? []).length === 0 && <Typography color="text.secondary">Nenhuma campanha ainda.</Typography>}
      </Stack>

      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Nova campanha</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="Nome" value={name} onChange={(e) => setName(e.target.value)} required />
            <TextField
              label="Etiquetas (separadas por vírgula)"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              helperText="Ex.: premium, corporativo"
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancelar</Button>
          <Button variant="contained" onClick={() => create.mutate()} disabled={create.isPending || !name}>
            {create.isPending ? "Criando..." : "Criar"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
