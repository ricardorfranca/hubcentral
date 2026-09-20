/**
 * @file ForecastDashboard.tsx
 * @module modules/crm
 *
 * Dashboard de Receita Previsível: forecast ponderado, novo MRR/ARR do período,
 * pipeline por estágio, por origem e por responsável.
 */

import {
  Box, Typography, Card, CardContent, Grid2 as Grid, Table, TableBody, TableCell,
  TableHead, TableRow, CircularProgress,
} from "@mui/material";
import { useForecast } from "./sales-hooks.js";
import { brl } from "./format.js";
import { ORIGIN_LABELS } from "./format.js";

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
 * Dashboard de forecast (Receita Previsível).
 *
 * @returns A tela de dashboards.
 */
export function ForecastDashboard(): JSX.Element {
  const { data, isLoading } = useForecast();

  if (isLoading || !data) {
    return <Box sx={{ display: "grid", placeItems: "center", height: 200 }}><CircularProgress /></Box>;
  }

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 2 }}>Receita Previsível</Typography>

      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid size={{ xs: 6, md: 3 }}><Metric label="Forecast ponderado (ARR)" value={brl(data.weighted.weighted)} /></Grid>
        <Grid size={{ xs: 6, md: 3 }}><Metric label="Novo MRR (mês)" value={brl(data.period.new_mrr)} /></Grid>
        <Grid size={{ xs: 6, md: 3 }}><Metric label="Novo ARR (mês)" value={brl(data.period.new_arr)} /></Grid>
        <Grid size={{ xs: 6, md: 3 }}><Metric label="Ganhos (mês)" value={data.period.won_count} /></Grid>
      </Grid>

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 4 }}>
          <Card variant="outlined">
            <CardContent>
              <Typography variant="h6" gutterBottom>Pipeline por estágio</Typography>
              <Table size="small">
                <TableHead>
                  <TableRow><TableCell>Estágio</TableCell><TableCell align="right">Qtd.</TableCell></TableRow>
                </TableHead>
                <TableBody>
                  {data.by_stage.map((r) => (
                    <TableRow key={r.stage_id}><TableCell>{r.label}</TableCell><TableCell align="right">{r.count}</TableCell></TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, md: 4 }}>
          <Card variant="outlined">
            <CardContent>
              <Typography variant="h6" gutterBottom>Pipeline por origem</Typography>
              <Table size="small">
                <TableHead>
                  <TableRow><TableCell>Origem</TableCell><TableCell align="right">Qtd.</TableCell><TableCell align="right">MRR</TableCell></TableRow>
                </TableHead>
                <TableBody>
                  {data.by_origin.map((r, i) => (
                    <TableRow key={i}>
                      <TableCell>{r.origin ? (ORIGIN_LABELS[r.origin] ?? r.origin) : "—"}</TableCell>
                      <TableCell align="right">{r.count}</TableCell>
                      <TableCell align="right">{brl(r.mrr)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, md: 4 }}>
          <Card variant="outlined">
            <CardContent>
              <Typography variant="h6" gutterBottom>Pipeline por responsável</Typography>
              <Table size="small">
                <TableHead>
                  <TableRow><TableCell>Responsável</TableCell><TableCell align="right">Qtd.</TableCell><TableCell align="right">Ponderado</TableCell></TableRow>
                </TableHead>
                <TableBody>
                  {data.by_owner.map((r, i) => (
                    <TableRow key={i}>
                      <TableCell>{r.owner_user_id ?? "—"}</TableCell>
                      <TableCell align="right">{r.count}</TableCell>
                      <TableCell align="right">{brl(r.weighted)}</TableCell>
                    </TableRow>
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
