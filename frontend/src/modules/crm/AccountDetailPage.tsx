/**
 * @file AccountDetailPage.tsx
 * @module modules/crm
 *
 * Detalhe de conta: dados da empresa, contatos vinculados (com papéis) e as
 * oportunidades da conta (histórico recorrente de Receita Previsível).
 */

import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  Box, Typography, Paper, Grid2 as Grid, Stack, Button, List, ListItem, ListItemText,
  Table, TableBody, TableCell, TableHead, TableRow, Chip, CircularProgress,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import { useAccount, useOpportunities } from "./sales-hooks.js";
import { useCan } from "../../core/rbac/can.js";
import { NewOpportunityDialog } from "./NewOpportunityDialog.js";
import { brl } from "./format.js";

/**
 * Página de detalhe de uma conta.
 *
 * @returns A tela de detalhe de conta.
 */
export function AccountDetailPage(): JSX.Element {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const can = useCan();
  const { data: account, isLoading } = useAccount(id);
  const { data: opps } = useOpportunities({ account_id: id });
  const [dialogOpen, setDialogOpen] = useState(false);

  if (isLoading || !account) {
    return <Box sx={{ display: "grid", placeItems: "center", height: 200 }}><CircularProgress /></Box>;
  }

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Box>
          <Typography variant="h5">{account.legal_name ?? "Conta"}</Typography>
          {account.cnpj && <Typography color="text.secondary">CNPJ: {account.cnpj}</Typography>}
        </Box>
        {can("crm:oportunidades:criar") && (
          <Button startIcon={<AddIcon />} variant="contained" onClick={() => setDialogOpen(true)}>
            Nova oportunidade
          </Button>
        )}
      </Stack>

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 4 }}>
          <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
            <Typography variant="h6" gutterBottom>Empresa</Typography>
            <Stack spacing={1}>
              <Chip label={`Segmento: ${account.segment ?? "—"}`} />
              <Chip label={`Porte: ${account.size_tier ?? "—"}`} />
            </Stack>
          </Paper>
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="h6" gutterBottom>Contatos</Typography>
            <List dense>
              {(account.contacts ?? []).map((c) => (
                <ListItem key={c.person_contact_id} disableGutters>
                  <ListItemText primary={c.full_name ?? c.person_contact_id} secondary={c.role ?? "—"} />
                </ListItem>
              ))}
              {(account.contacts ?? []).length === 0 && (
                <Typography color="text.secondary">Nenhum contato vinculado.</Typography>
              )}
            </List>
          </Paper>
        </Grid>

        <Grid size={{ xs: 12, md: 8 }}>
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="h6" gutterBottom>Oportunidades</Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Nome</TableCell>
                  <TableCell align="right">MRR</TableCell>
                  <TableCell align="right">ARR</TableCell>
                  <TableCell>Status</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(opps ?? []).map((o) => (
                  <TableRow key={o.id} hover sx={{ cursor: "pointer" }} onClick={() => navigate(`/crm/oportunidades/${o.id}`)}>
                    <TableCell>{o.name}</TableCell>
                    <TableCell align="right">{brl(o.mrr)}</TableCell>
                    <TableCell align="right">{brl(o.arr ?? Number(o.mrr) * 12)}</TableCell>
                    <TableCell>
                      {o.status === "won" ? "Ganho" : o.status === "lost" ? "Perdido" : "Aberta"}
                    </TableCell>
                  </TableRow>
                ))}
                {(opps ?? []).length === 0 && (
                  <TableRow><TableCell colSpan={4}><Typography color="text.secondary">Nenhuma oportunidade.</Typography></TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </Paper>
        </Grid>
      </Grid>

      <NewOpportunityDialog open={dialogOpen} onClose={() => setDialogOpen(false)} accountId={id} />
    </Box>
  );
}
