/**
 * @file AccountsPage.tsx
 * @module modules/crm
 *
 * Lista de contas (empresas B2B) do CRM 2.0. Contas são permanentes: a fonte de
 * verdade é `core.contacts`. Permite criar conta a partir de razão social + CNPJ.
 */

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Box, Typography, Stack, Button, Table, TableBody, TableCell, TableHead, TableRow,
  Paper, CircularProgress, Dialog, DialogTitle, DialogContent, DialogActions, TextField,
  Alert, TableContainer,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import { useAccounts, useCreateAccount } from "./sales-hooks.js";
import { useCan } from "../../core/rbac/can.js";
import { ApiError } from "../../core/api/client.js";

/**
 * Página de listagem de contas.
 *
 * @returns A tela de contas.
 */
export function AccountsPage(): JSX.Element {
  const navigate = useNavigate();
  const can = useCan();
  const { data: accounts, isLoading } = useAccounts();
  const [dialogOpen, setDialogOpen] = useState(false);

  if (isLoading) {
    return <Box sx={{ display: "grid", placeItems: "center", height: 200 }}><CircularProgress /></Box>;
  }

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Typography variant="h5">Empresas</Typography>
        {can("crm:contas:criar") && (
          <Button startIcon={<AddIcon />} variant="contained" onClick={() => setDialogOpen(true)}>
            Nova empresa
          </Button>
        )}
      </Stack>

      <TableContainer component={Paper} variant="outlined">
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Razão social</TableCell>
              <TableCell>CNPJ</TableCell>
              <TableCell>Segmento</TableCell>
              <TableCell>Porte</TableCell>
              <TableCell align="right">Contatos</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {(accounts ?? []).map((a) => (
              <TableRow key={a.id} hover sx={{ cursor: "pointer" }} onClick={() => navigate(`/crm/contas/${a.id}`)}>
                <TableCell>{a.legal_name ?? "—"}</TableCell>
                <TableCell>{a.cnpj ?? "—"}</TableCell>
                <TableCell>{a.segment ?? "—"}</TableCell>
                <TableCell>{a.size_tier ?? "—"}</TableCell>
                <TableCell align="right">{a.contacts?.length ?? 0}</TableCell>
              </TableRow>
            ))}
            {(accounts ?? []).length === 0 && (
              <TableRow><TableCell colSpan={5}><Typography color="text.secondary">Nenhuma empresa cadastrada.</Typography></TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <NewAccountDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </Box>
  );
}

/** Diálogo de criação de conta. */
function NewAccountDialog({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element {
  const create = useCreateAccount();
  const [legalName, setLegalName] = useState("");
  const [cnpj, setCnpj] = useState("");
  const [segment, setSegment] = useState("");
  const [sizeTier, setSizeTier] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit(): Promise<void> {
    setError(null);
    if (!legalName.trim() || !cnpj.trim()) {
      setError("Razão social e CNPJ são obrigatórios.");
      return;
    }
    try {
      await create.mutateAsync({
        legal_name: legalName.trim(),
        cnpj: cnpj.trim(),
        segment: segment.trim() || undefined,
        size_tier: sizeTier.trim() || undefined,
      });
      setLegalName("");
      setCnpj("");
      setSegment("");
      setSizeTier("");
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Falha ao criar conta.");
    }
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Nova empresa</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField label="Razão social" value={legalName} onChange={(e) => setLegalName(e.target.value)} required />
          <TextField label="CNPJ" value={cnpj} onChange={(e) => setCnpj(e.target.value)} required placeholder="00.000.000/0000-00" />
          <Stack direction="row" spacing={2}>
            <TextField label="Segmento" value={segment} onChange={(e) => setSegment(e.target.value)} fullWidth />
            <TextField label="Porte" value={sizeTier} onChange={(e) => setSizeTier(e.target.value)} fullWidth />
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancelar</Button>
        <Button variant="contained" onClick={submit} disabled={create.isPending}>Criar</Button>
      </DialogActions>
    </Dialog>
  );
}
