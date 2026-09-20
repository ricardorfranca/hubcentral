/**
 * @file UsersPage.tsx
 * @module modules/admin
 *
 * Administração de usuários: lista, convite, alteração de papel/status e edição
 * de permissões RBAC. Exige `core:usuarios:gerenciar`.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Box, Typography, Button, Table, TableHead, TableRow, TableCell, TableBody, Chip,
  Select, MenuItem, Stack, Dialog, DialogTitle, DialogContent, DialogActions, TextField,
  Alert, CircularProgress, IconButton, Tooltip, FormControlLabel, Switch,
} from "@mui/material";
import PersonAddIcon from "@mui/icons-material/PersonAdd";
import SecurityIcon from "@mui/icons-material/Security";
import ReplayIcon from "@mui/icons-material/Replay";
import KeyIcon from "@mui/icons-material/Key";
import WhatsAppIcon from "@mui/icons-material/WhatsApp";
import { listUsers, inviteUser, updateUser, resendInvite, setUserPassword, type AdminUser } from "../../core/api/iam.js";
import { getUserChannel, saveUserChannel, type UserChannel } from "../../core/api/comms.js";
import { ApiError } from "../../core/api/client.js";
import type { UserRole } from "../../core/api/types.js";
import { PermissionsDialog } from "./PermissionsDialog.js";

const ROLES: UserRole[] = ["superadmin", "module_admin", "operator", "client"];

/**
 * Página de administração de usuários.
 *
 * @returns A tela de usuários.
 */
export function UsersPage(): JSX.Element {
  const qc = useQueryClient();
  const { data: users, isLoading } = useQuery({ queryKey: ["iam", "users"], queryFn: listUsers });
  const [inviteOpen, setInviteOpen] = useState(false);
  const [permUser, setPermUser] = useState<AdminUser | null>(null);
  const [pwdUser, setPwdUser] = useState<AdminUser | null>(null);
  const [chanUser, setChanUser] = useState<AdminUser | null>(null);
  const [error, setError] = useState<string | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["iam", "users"] });

  const changeRole = useMutation({
    mutationFn: ({ id, role }: { id: string; role: UserRole }) => updateUser(id, { role }),
    onSuccess: invalidate,
    onError: (e) => setError(e instanceof ApiError ? e.message : "Falha ao alterar papel."),
  });
  const toggleStatus = useMutation({
    mutationFn: (u: AdminUser) => updateUser(u.id, { status: u.status === "active" ? "disabled" : "active" }),
    onSuccess: invalidate,
  });
  const resend = useMutation({
    mutationFn: (id: string) => resendInvite(id),
    onError: (e) => setError(e instanceof ApiError ? e.message : "Falha ao reenviar (aguarde o cooldown)."),
  });

  if (isLoading) {
    return <Box sx={{ display: "grid", placeItems: "center", height: 200 }}><CircularProgress /></Box>;
  }

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Typography variant="h5">Usuários</Typography>
        <Button startIcon={<PersonAddIcon />} variant="contained" onClick={() => setInviteOpen(true)}>Convidar</Button>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>E-mail</TableCell><TableCell>Nome</TableCell><TableCell>Papel</TableCell>
            <TableCell>Ramal</TableCell><TableCell>Status</TableCell><TableCell align="right">Ações</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {(users ?? []).map((u) => (
            <TableRow key={u.id}>
              <TableCell>{u.email}</TableCell>
              <TableCell>{u.full_name}</TableCell>
              <TableCell>
                <Select
                  size="small"
                  value={u.role}
                  onChange={(e) => changeRole.mutate({ id: u.id, role: e.target.value as UserRole })}
                >
                  {ROLES.map((r) => <MenuItem key={r} value={r}>{r}</MenuItem>)}
                </Select>
              </TableCell>
              <TableCell>
                <ExtensionCell user={u} onSaved={invalidate} onError={setError} />
              </TableCell>
              <TableCell>
                <Chip
                  label={u.status === "active" ? "ativo" : "desabilitado"}
                  color={u.status === "active" ? "success" : "default"}
                  size="small"
                  onClick={() => toggleStatus.mutate(u)}
                />
              </TableCell>
              <TableCell align="right">
                {!u.password_set && (
                  <Tooltip title="Reenviar convite">
                    <IconButton size="small" onClick={() => resend.mutate(u.id)}><ReplayIcon fontSize="small" /></IconButton>
                  </Tooltip>
                )}
                <Tooltip title="Canal de WhatsApp (Evolution API)">
                  <IconButton size="small" onClick={() => setChanUser(u)}><WhatsAppIcon fontSize="small" /></IconButton>
                </Tooltip>
                <Tooltip title="Definir senha">
                  <IconButton size="small" onClick={() => setPwdUser(u)}><KeyIcon fontSize="small" /></IconButton>
                </Tooltip>
                <Tooltip title="Permissões">
                  <IconButton size="small" onClick={() => setPermUser(u)}><SecurityIcon fontSize="small" /></IconButton>
                </Tooltip>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <InviteDialog open={inviteOpen} onClose={() => setInviteOpen(false)} onDone={invalidate} onError={setError} />
      {permUser && <PermissionsDialog user={permUser} onClose={() => setPermUser(null)} />}
      {pwdUser && <PasswordDialog user={pwdUser} onClose={() => setPwdUser(null)} onError={setError} />}
      {chanUser && <WhatsappChannelDialog user={chanUser} onClose={() => setChanUser(null)} onError={setError} />}
    </Box>
  );
}

/** Célula de edição inline do ramal do usuário no PABX. */
function ExtensionCell({
  user, onSaved, onError,
}: {
  user: AdminUser; onSaved: () => void; onError: (m: string) => void;
}): JSX.Element {
  const [value, setValue] = useState(user.extension ?? "");
  const save = useMutation({
    mutationFn: (ext: string) => updateUser(user.id, { extension: ext.trim() === "" ? null : ext.trim() }),
    onSuccess: onSaved,
    onError: (e) => onError(e instanceof ApiError ? e.message : "Falha ao salvar ramal."),
  });
  const dirty = (value ?? "") !== (user.extension ?? "");

  return (
    <TextField
      size="small"
      placeholder="—"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => { if (dirty) save.mutate(value); }}
      sx={{ width: 90 }}
      inputProps={{ "aria-label": `Ramal de ${user.full_name}` }}
    />
  );
}

/**
 * Diálogo de configuração do canal de WhatsApp (Evolution API) de um usuário.
 * O superadministrador pode inserir/editar as credenciais de qualquer usuário.
 * A API key só é enviada quando alterada (o backend não a devolve por segurança).
 */
function WhatsappChannelDialog({
  user, onClose, onError,
}: {
  user: AdminUser; onClose: () => void; onError: (m: string) => void;
}): JSX.Element {
  const { data, isLoading } = useQuery<UserChannel>({
    queryKey: ["iam", "channel", user.id],
    queryFn: () => getUserChannel(user.id),
  });
  const [url, setUrl] = useState("");
  const [instance, setInstance] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  if (data && !hydrated) {
    setUrl(data.wa_evolution_url ?? "");
    setInstance(data.wa_instance ?? "");
    setEnabled(data.wa_enabled);
    setHydrated(true);
  }

  const save = useMutation({
    mutationFn: () => saveUserChannel(user.id, {
      wa_evolution_url: url.trim() === "" ? null : url.trim(),
      wa_instance: instance.trim() === "" ? null : instance.trim(),
      // Só envia a API key se o admin digitou uma nova.
      ...(apiKey.trim() !== "" ? { wa_api_key: apiKey.trim() } : {}),
      wa_enabled: enabled,
    }),
    onSuccess: onClose,
    onError: (e) => onError(e instanceof ApiError ? e.message : "Falha ao salvar canal."),
  });

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Canal de WhatsApp — {user.full_name}</DialogTitle>
      <DialogContent>
        {isLoading ? (
          <Box sx={{ display: "grid", placeItems: "center", height: 120 }}><CircularProgress /></Box>
        ) : (
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Alert severity="info">
              Deixe URL e API key em branco para usar os valores globais (fallback) definidos em Configurações.
            </Alert>
            <TextField
              label="Evolution API — URL base"
              placeholder="https://evo.suaempresa.com"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
            <TextField
              label="Instância / sessão"
              placeholder="nome-da-instancia"
              value={instance}
              onChange={(e) => setInstance(e.target.value)}
            />
            <TextField
              label={data?.wa_api_key_set ? "API key (deixe em branco para manter)" : "API key"}
              type="password"
              autoComplete="new-password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
            <FormControlLabel
              control={<Switch checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />}
              label={enabled ? "Canal habilitado" : "Canal desabilitado"}
            />
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancelar</Button>
        <Button variant="contained" onClick={() => save.mutate()} disabled={save.isPending || isLoading}>
          {save.isPending ? "Salvando…" : "Salvar"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** Diálogo para o admin definir a senha de um usuário. */
function PasswordDialog({
  user, onClose, onError,
}: {
  user: AdminUser; onClose: () => void; onError: (m: string) => void;
}): JSX.Element {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => setUserPassword(user.id, password),
    onSuccess: onClose,
    onError: (e) => onError(e instanceof ApiError ? e.message : "Falha ao definir senha."),
  });

  function submit(): void {
    setLocalError(null);
    if (password.length < 8) { setLocalError("A senha deve ter ao menos 8 caracteres."); return; }
    if (password !== confirm) { setLocalError("As senhas não conferem."); return; }
    save.mutate();
  }

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Definir senha — {user.full_name}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {localError && <Alert severity="error">{localError}</Alert>}
          <TextField label="Nova senha" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
          <TextField label="Confirmar senha" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancelar</Button>
        <Button variant="contained" onClick={submit} disabled={save.isPending}>Salvar</Button>
      </DialogActions>
    </Dialog>
  );
}

/** Diálogo de convite de usuário. */
function InviteDialog({
  open, onClose, onDone, onError,
}: {
  open: boolean; onClose: () => void; onDone: () => void; onError: (m: string) => void;
}): JSX.Element {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<UserRole>("operator");
  const invite = useMutation({
    mutationFn: () => inviteUser(email, name, role),
    onSuccess: () => { onDone(); onClose(); setEmail(""); setName(""); },
    onError: (e) => onError(e instanceof ApiError ? e.message : "Falha ao convidar."),
  });

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Convidar usuário</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField label="E-mail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <TextField label="Nome" value={name} onChange={(e) => setName(e.target.value)} required />
          <Select value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
            {ROLES.map((r) => <MenuItem key={r} value={r}>{r}</MenuItem>)}
          </Select>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancelar</Button>
        <Button variant="contained" onClick={() => invite.mutate()} disabled={invite.isPending || !email || !name}>
          {invite.isPending ? "Convidando..." : "Convidar"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
