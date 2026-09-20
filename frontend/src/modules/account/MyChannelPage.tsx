/**
 * @file MyChannelPage.tsx
 * @module modules/account
 *
 * Autoatendimento do usuário: configuração do próprio canal de WhatsApp via
 * Evolution API (URL base, instância e API key). Valores em branco usam o
 * padrão global (fallback) definido pelo superadministrador em Configurações.
 */

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Box, Card, CardContent, Typography, Stack, TextField, Button, Switch,
  FormControlLabel, Alert, CircularProgress, Divider,
} from "@mui/material";
import { getMyChannel, saveMyChannel, testMyChannel, type UserChannel } from "../../core/api/comms.js";
import { ApiError } from "../../core/api/client.js";

/**
 * Página "Meu canal de WhatsApp".
 *
 * @returns A tela de configuração do canal do usuário.
 */
export function MyChannelPage(): JSX.Element {
  const { data, isLoading, refetch } = useQuery<UserChannel>({ queryKey: ["me", "channel"], queryFn: getMyChannel });
  const [url, setUrl] = useState("");
  const [instance, setInstance] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  if (data && !hydrated) {
    setUrl(data.wa_evolution_url ?? "");
    setInstance(data.wa_instance ?? "");
    setEnabled(data.wa_enabled);
    setHydrated(true);
  }

  const save = useMutation({
    mutationFn: () => saveMyChannel({
      wa_evolution_url: url.trim() === "" ? null : url.trim(),
      wa_instance: instance.trim() === "" ? null : instance.trim(),
      ...(apiKey.trim() !== "" ? { wa_api_key: apiKey.trim() } : {}),
      wa_enabled: enabled,
    }),
    onSuccess: () => { setApiKey(""); setMsg({ ok: true, text: "Canal salvo." }); void refetch(); },
    onError: (e) => setMsg({ ok: false, text: e instanceof ApiError ? e.message : "Falha ao salvar." }),
  });

  const test = useMutation({
    mutationFn: () => testMyChannel(),
    onSuccess: (r) => setMsg({ ok: true, text: `Instância "${r.instance}" conectada.` }),
    onError: (e) => setMsg({ ok: false, text: e instanceof Error ? e.message : "Falha ao testar." }),
  });

  if (isLoading) {
    return <Box sx={{ display: "grid", placeItems: "center", height: 200 }}><CircularProgress /></Box>;
  }

  return (
    <Box sx={{ maxWidth: 640 }}>
      <Typography variant="h5" sx={{ mb: 0.5 }}>Meu canal de WhatsApp</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Conecte sua própria instância da Evolution API para enviar mensagens de WhatsApp a partir dos contatos.
      </Typography>
      <Card variant="outlined">
        <CardContent>
          {msg && <Alert severity={msg.ok ? "success" : "error"} sx={{ mb: 2 }} onClose={() => setMsg(null)}>{msg.text}</Alert>}
          <Stack spacing={2}>
            <Alert severity="info">
              Deixe URL e API key em branco para usar os valores globais definidos pelo administrador.
            </Alert>
            <TextField label="Evolution API — URL base" placeholder="https://evo.suaempresa.com" value={url} onChange={(e) => setUrl(e.target.value)} fullWidth />
            <TextField label="Instância / sessão" placeholder="minha-instancia" value={instance} onChange={(e) => setInstance(e.target.value)} fullWidth />
            <TextField
              label={data?.wa_api_key_set ? "API key (deixe em branco para manter)" : "API key"}
              type="password"
              autoComplete="new-password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              fullWidth
            />
            <FormControlLabel
              control={<Switch checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />}
              label={enabled ? "Canal habilitado" : "Canal desabilitado"}
            />
            <Divider />
            <Stack direction="row" spacing={1}>
              <Button variant="contained" onClick={() => save.mutate()} disabled={save.isPending}>
                {save.isPending ? "Salvando…" : "Salvar"}
              </Button>
              <Button variant="outlined" onClick={() => test.mutate()} disabled={test.isPending}>
                {test.isPending ? "Testando…" : "Testar conexão"}
              </Button>
            </Stack>
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
}
