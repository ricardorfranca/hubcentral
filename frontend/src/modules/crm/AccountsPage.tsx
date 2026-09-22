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
import { lookupCnpj, companyFieldsFromCnpj, type CnpjData } from "../../core/api/contacts.js";

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
  const [lookup, setLookup] = useState(false);
  const [cnpjData, setCnpjData] = useState<CnpjData | null>(null);
  const [cnpjNotFound, setCnpjNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Busca os dados oficiais do CNPJ, preenche a razão social e guarda o resto. */
  async function onCnpjBlur(): Promise<void> {
    if (cnpj.replace(/\D/g, "").length !== 14) return;
    setLookup(true);
    setCnpjNotFound(false);
    const data = await lookupCnpj(cnpj);
    setLookup(false);
    setCnpjData(data);
    if (!data) {
      setCnpjNotFound(true);
      return;
    }
    if (data.legal_name && !legalName) setLegalName(data.legal_name);
  }

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
        // Grava no cadastro da empresa o que o autofill trouxe (cidade, UF, telefone).
        ...(cnpjData ? { company: companyFieldsFromCnpj(cnpjData) } : {}),
      });
      setLegalName("");
      setCnpj("");
      setSegment("");
      setSizeTier("");
      setCnpjData(null);
      setCnpjNotFound(false);
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
          <TextField
            label="CNPJ"
            value={cnpj}
            onChange={(e) => setCnpj(e.target.value)}
            onBlur={onCnpjBlur}
            required
            autoFocus
            placeholder="00.000.000/0000-00"
            helperText={lookup ? "Consultando dados oficiais…" : "Ao sair do campo, buscamos os dados oficiais (editáveis)."}
          />
          {cnpjNotFound && (
            <Alert severity="warning">
              Não conseguimos consultar os dados oficiais deste CNPJ. Preencha a razão social manualmente.
            </Alert>
          )}
          <TextField label="Razão social" value={legalName} onChange={(e) => setLegalName(e.target.value)} required />
          {cnpjData && (
            <Alert severity="success" icon={false}>
              <Typography variant="body2">
                {[
                  cnpjData.trade_name ? `Nome fantasia: ${cnpjData.trade_name}` : null,
                  [cnpjData.city, cnpjData.state].filter(Boolean).join("/") || null,
                  cnpjData.phone ? `Tel.: ${cnpjData.phone}` : null,
                ].filter(Boolean).join(" · ") || "Apenas a razão social foi encontrada."}
              </Typography>
              <Typography variant="caption" color="text.secondary" component="div">
                Cidade, UF e telefone são gravados no cadastro. Endereço e demais campos: Contatos → Empresas.
              </Typography>
            </Alert>
          )}
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
