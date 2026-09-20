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
  Alert, CircularProgress, IconButton, Tooltip,
} from "@mui/material";
import PersonAddIcon from "@mui/icons-material/PersonAdd";
import SecurityIcon from "@mui/icons-material/Security";
import ReplayIcon from "@mui/icons-material/Replay";
import { listUsers, inviteUser, updateUser, resendInvite, type AdminUser } from "../../core/api/iam.js";
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
            <TableCell>Status</TableCell><TableCell align="right">Ações</TableCell>
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
    </Box>
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
