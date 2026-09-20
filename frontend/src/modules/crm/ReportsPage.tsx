/**
 * @file ReportsPage.tsx
 * @module modules/crm
 *
 * Tela de relatórios: indicadores de fechamentos, SLA, performance e motivos
 * de perda.
 */

import { useQuery } from "@tanstack/react-query";
import {
  Box, Typography, Card, CardContent, Grid2 as Grid, Table, TableBody, TableCell,
  TableHead, TableRow, CircularProgress,
} from "@mui/material";
import { reportClosings, reportSla, reportPerformance, reportLossReasons } from "../../core/api/crm-extra.js";

/** Cartão de indicador simples. */
function Metric({ label, value }: { label: string; value: string | number }): JSX.Element {
  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="overline" color="text.secondary">{label}</Typography>
        <Typography variant="h4">{value}</Typography>
      </CardContent>
    </Card>
  );
}

/**
 * Página de relatórios do CRM.
 *
 * @returns A tela de relatórios.
 */
export function ReportsPage(): JSX.Element {
  const closings = useQuery({ queryKey: ["crm", "rep", "closings"], queryFn: reportClosings });
  const sla = useQuery({ queryKey: ["crm", "rep", "sla"], queryFn: reportSla });
  const performance = useQuery({ queryKey: ["crm", "rep", "perf"], queryFn: reportPerformance });
  const losses = useQuery({ queryKey: ["crm", "rep", "loss"], queryFn: reportLossReasons });

  if (closings.isLoading || sla.isLoading) {
    return <Box sx={{ display: "grid", placeItems: "center", height: 200 }}><CircularProgress /></Box>;
  }

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 2 }}>Relatórios</Typography>

      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid size={{ xs: 6, md: 3 }}><Metric label="Ganhos (mês)" value={closings.data?.won ?? 0} /></Grid>
        <Grid size={{ xs: 6, md: 3 }}><Metric label="Perdidos (mês)" value={closings.data?.lost ?? 0} /></Grid>
        <Grid size={{ xs: 6, md: 3 }}><Metric label="SLA vencidos" value={sla.data?.overdue ?? 0} /></Grid>
        <Grid size={{ xs: 6, md: 3 }}><Metric label="SLA no prazo" value={sla.data?.on_time ?? 0} /></Grid>
      </Grid>

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 6 }}>
          <Card variant="outlined">
            <CardContent>
              <Typography variant="h6" gutterBottom>Performance por vendedor</Typography>
              <Table size="small">
                <TableHead>
                  <TableRow><TableCell>Vendedor</TableCell><TableCell align="right">Total</TableCell><TableCell align="right">Ganhos</TableCell><TableCell align="right">Perdidos</TableCell></TableRow>
                </TableHead>
                <TableBody>
                  {(performance.data ?? []).map((r, i) => (
                    <TableRow key={i}>
                      <TableCell>{r.assigned_to ?? "—"}</TableCell>
                      <TableCell align="right">{r.total}</TableCell>
                      <TableCell align="right">{r.won}</TableCell>
                      <TableCell align="right">{r.lost}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <Card variant="outlined">
            <CardContent>
              <Typography variant="h6" gutterBottom>Motivos de perda</Typography>
              <Table size="small">
                <TableHead>
                  <TableRow><TableCell>Motivo</TableCell><TableCell align="right">Qtd.</TableCell></TableRow>
                </TableHead>
                <TableBody>
                  {(losses.data ?? []).map((r, i) => (
                    <TableRow key={i}><TableCell>{r.loss_reason ?? "—"}</TableCell><TableCell align="right">{r.count}</TableCell></TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
}
