/**
 * @file ApiKeysPage.tsx
 * @module modules/admin
 *
 * Administração de chaves de API externas (integrações). Exclusiva do
 * SuperAdministrador. Permite criar chaves (o segredo é exibido uma única vez),
 * conceder permissões (namespaces) por chave, revisar uso e revogar. É o análogo
 * de "usuários de sistema" para sistemas externos operarem via API de forma
 * controlada.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link as RouterLink } from "react-router-dom";
import {
  Box, Typography, Button, Stack, Paper, TextField, Table, TableHead, TableRow, TableCell,
  TableBody, TableContainer, Chip, IconButton, Tooltip, Alert, CircularProgress, Dialog,
  DialogTitle, DialogContent, DialogActions, FormControlLabel, Checkbox, Divider,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import BlockIcon from "@mui/icons-material/Block";
import KeyIcon from "@mui/icons-material/Key";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import MenuBookIcon from "@mui/icons-material/MenuBook";
import {
  listApiKeys, listApiKeyNamespaces, createApiKey, setApiKeyPermissions, revokeApiKey,
  type ApiKey, type CreatedApiKey,
} from "../../core/api/api-keys.js";
import { ApiError } from "../../core/api/client.js";
import { SuperadminGuard } from "./SuperadminGuard.js";

/**
 * Página de administração de chaves de API. Protegida para SuperAdministradores.
 *
 * @returns A tela de chaves de API.
 */
export function ApiKeysPage(): JSX.Element {
  return (
    <SuperadminGuard>
      <ApiKeysManager />
    </SuperadminGuard>
  );
}

/** Conteúdo da página (já dentro do guard). */
function ApiKeysManager(): JSX.Element {
  const qc = useQueryClient();
  const { data: keys, isLoading } = useQuery({ queryKey: ["api-keys"], queryFn: listApiKeys });
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedApiKey | null>(null);
  const [permsFor, setPermsFor] = useState<ApiKey | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["api-keys"] });

  const create = useMutation({
    mutationFn: () => createApiKey(name.trim()),
    onSuccess: (k) => { setName(""); setCreated(k); invalidate(); },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Falha ao criar chave."),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => revokeApiKey(id),
    onSuccess: invalidate,
    onError: (e) => setError(e instanceof ApiError ? e.message : "Falha ao revogar chave."),
  });

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
        <Box>
          <Typography variant="h5" sx={{ mb: 0.5 }}>APIs externas</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1, maxWidth: 720 }}>
            Crie chaves de API para que sistemas externos (como uma landing page) executem operações de forma
            controlada por permissões. O segredo é exibido apenas uma vez, na criação.
          </Typography>
        </Box>
        <Button component={RouterLink} to="/admin/api-docs" startIcon={<MenuBookIcon />} variant="outlined">
          Documentação da API
        </Button>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <TextField
            size="small" label="Nome da chave" value={name} onChange={(e) => setName(e.target.value)}
            placeholder="Landing Page — Site" sx={{ minWidth: 280 }}
          />
          <Button startIcon={<AddIcon />} variant="contained" onClick={() => create.mutate()} disabled={create.isPending || name.trim() === ""}>
            Criar chave
          </Button>
        </Stack>
      </Paper>

      {isLoading ? (
        <Box sx={{ display: "grid", placeItems: "center", height: 160 }}><CircularProgress /></Box>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Nome</TableCell>
                <TableCell>Identificador</TableCell>
                <TableCell>Permissões</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Último uso</TableCell>
                <TableCell align="right">Ações</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(keys ?? []).map((k) => (
                <TableRow key={k.id}>
                  <TableCell>{k.name}</TableCell>
                  <TableCell><code>{k.prefix}…</code></TableCell>
                  <TableCell>
                    {k.permissions.length === 0
                      ? <Typography variant="caption" color="text.secondary">Nenhuma</Typography>
                      : k.permissions.map((p) => <Chip key={p} size="small" label={p} sx={{ mr: 0.5, mb: 0.5 }} />)}
                  </TableCell>
                  <TableCell>
                    <Chip size="small" label={k.status === "active" ? "Ativa" : "Revogada"} color={k.status === "active" ? "success" : "default"} />
                  </TableCell>
                  <TableCell>
                    {k.last_used_at ? new Date(k.last_used_at).toLocaleString("pt-BR") : "—"}
                  </TableCell>
                  <TableCell align="right">
                    <Tooltip title="Permissões">
                      <span>
                        <IconButton size="small" onClick={() => setPermsFor(k)} disabled={k.status !== "active"} aria-label="permissões">
                          <KeyIcon fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                    <Tooltip title="Revogar chave">
                      <span>
                        <IconButton size="small" color="error" onClick={() => revoke.mutate(k.id)} disabled={k.status !== "active"} aria-label="revogar">
                          <BlockIcon fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
              {(keys ?? []).length === 0 && (
                <TableRow><TableCell colSpan={6}><Typography color="text.secondary">Nenhuma chave de API.</Typography></TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {created && <SecretDialog created={created} onClose={() => setCreated(null)} />}
      {permsFor && <PermissionsDialog apiKey={permsFor} onClose={() => setPermsFor(null)} />}
    </Box>
  );
}

/** Diálogo que exibe o segredo recém-criado (uma única vez). */
function SecretDialog({ created, onClose }: { created: CreatedApiKey; onClose: () => void }): JSX.Element {
  const [copied, setCopied] = useState(false);
  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(created.secret);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Chave criada — {created.name}</DialogTitle>
      <DialogContent>
        <Alert severity="warning" sx={{ mb: 2 }}>
          Copie o segredo agora. Por segurança, ele não será exibido novamente.
        </Alert>
        <Stack direction="row" spacing={1} alignItems="center">
          <TextField fullWidth size="small" value={created.secret} InputProps={{ readOnly: true }} />
          <Tooltip title={copied ? "Copiado!" : "Copiar"}>
            <IconButton onClick={copy} aria-label="copiar segredo"><ContentCopyIcon /></IconButton>
          </Tooltip>
        </Stack>
        <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: "block" }}>
          Envie este segredo no cabeçalho <code>Authorization: Bearer &lt;segredo&gt;</code> ou <code>X-API-Key: &lt;segredo&gt;</code>.
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button variant="contained" onClick={onClose}>Concluir</Button>
      </DialogActions>
    </Dialog>
  );
}

/** Diálogo de edição das permissões (namespaces) de uma chave. */
function PermissionsDialog({ apiKey, onClose }: { apiKey: ApiKey; onClose: () => void }): JSX.Element {
  const qc = useQueryClient();
  const { data: catalog, isLoading } = useQuery({ queryKey: ["api-keys", "namespaces"], queryFn: listApiKeyNamespaces });
  const [selected, setSelected] = useState<Set<string>>(new Set(apiKey.permissions));

  const save = useMutation({
    mutationFn: (perms: string[]) => setApiKeyPermissions(apiKey.id, perms),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["api-keys"] }); onClose(); },
  });

  function toggle(ns: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(ns)) next.delete(ns); else next.add(ns);
      return next;
    });
  }

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Permissões — {apiKey.name}</DialogTitle>
      <DialogContent dividers>
        {isLoading ? (
          <Box sx={{ display: "grid", placeItems: "center", height: 120 }}><CircularProgress /></Box>
        ) : (
          <>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              Conceda apenas as operações necessárias a esta integração.
            </Typography>
            <Divider sx={{ mb: 1 }} />
            <Stack>
              {(catalog ?? []).map((ns) => (
                <FormControlLabel
                  key={ns}
                  control={<Checkbox size="small" checked={selected.has(ns)} onChange={() => toggle(ns)} />}
                  label={<Typography variant="body2">{ns}</Typography>}
                />
              ))}
              {(catalog ?? []).length === 0 && (
                <Typography variant="caption" color="text.secondary">Nenhum namespace de API disponível.</Typography>
              )}
            </Stack>
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancelar</Button>
        <Button variant="contained" onClick={() => save.mutate(Array.from(selected))} disabled={save.isPending}>
          {save.isPending ? "Salvando…" : "Salvar"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
