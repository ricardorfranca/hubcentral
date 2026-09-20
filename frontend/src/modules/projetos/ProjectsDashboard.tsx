/**
 * @file ProjectsDashboard.tsx
 * @module modules/projetos
 *
 * Dashboard do SuperAdministrador: quantitativos, horas e custos por projeto e
 * totais gerais. Acesso restrito (o backend exige superadmin).
 */

import { useNavigate } from "react-router-dom";
import {
  Box, Typography, Card, CardContent, Grid2 as Grid, Table, TableBody, TableCell, TableHead,
  TableRow, CircularProgress, Chip, Alert,
} from "@mui/material";
import { useProjectsDashboard } from "./hooks.js";
import { brl, fmtMinutes } from "./format.js";
import { ApiError } from "../../core/api/client.js";

/** Cartão de indicador. */
function Metric({ label, value }: { label: string; value: string | number }): JSX.Element {
  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="overline" color="text.secondary">{label}</Typography>
        <Typography variant="h5">{value}</Typography>
      </CardContent>
    </Card>
  );
}

/**
 * Dashboard de projetos (superadmin).
 *
 * @returns A tela de dashboard.
 */
export function ProjectsDashboard(): JSX.Element {
  const navigate = useNavigate();
  const { data, isLoading, error } = useProjectsDashboard();

  if (isLoading) {
    return <Box sx={{ display: "grid", placeItems: "center", height: 200 }}><CircularProgress /></Box>;
  }
  if (error) {
    return <Alert severity="error">{error instanceof ApiError ? error.message : "Falha ao carregar o dashboard."}</Alert>;
  }
  if (!data) return <Typography>Sem dados.</Typography>;

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 2 }}>Dashboard de Projetos</Typography>

      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid size={{ xs: 12, md: 4 }}><Metric label="Projetos" value={data.totals.project_count} /></Grid>
        <Grid size={{ xs: 12, md: 4 }}><Metric label="Tempo total" value={fmtMinutes(data.totals.total_minutes)} /></Grid>
        <Grid size={{ xs: 12, md: 4 }}><Metric label="Custo total" value={brl(data.totals.total_cost)} /></Grid>
      </Grid>

      <Card variant="outlined">
        <CardContent>
          <Typography variant="h6" gutterBottom>Por projeto</Typography>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Projeto</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">Tarefas</TableCell>
                <TableCell align="right">Concluídas</TableCell>
                <TableCell align="right">Tempo</TableCell>
                <TableCell align="right">Mão de obra</TableCell>
                <TableCell align="right">Recursos</TableCell>
                <TableCell align="right">Total</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data.projects.map((p) => (
                <TableRow key={p.project_id} hover sx={{ cursor: "pointer" }} onClick={() => navigate(`/projetos/${p.project_id}`)}>
                  <TableCell>{p.name}</TableCell>
                  <TableCell>
                    <Chip size="small" label={p.status === "ativo" ? "Ativo" : "Arquivado"} color={p.status === "ativo" ? "success" : "default"} />
                  </TableCell>
                  <TableCell align="right">{p.task_count}</TableCell>
                  <TableCell align="right">{p.done_count}</TableCell>
                  <TableCell align="right">{fmtMinutes(p.total_minutes)}</TableCell>
                  <TableCell align="right">{brl(p.labor_cost)}</TableCell>
                  <TableCell align="right">{brl(p.resource_cost)}</TableCell>
                  <TableCell align="right">{brl(p.total_cost)}</TableCell>
                </TableRow>
              ))}
              {data.projects.length === 0 && (
                <TableRow><TableCell colSpan={8}><Typography color="text.secondary">Nenhum projeto.</Typography></TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </Box>
  );
}
