/**
 * @file LeadDetailPage.tsx
 * @module modules/crm
 *
 * Painel de detalhe do lead: dados de contato resolvidos da Base Central e a
 * timeline do lead (Req 5.3).
 */

import { useParams, useNavigate } from "react-router-dom";
import {
  Box, Typography, Card, CardContent, Grid2 as Grid, Button, Divider, List, ListItem, ListItemText, CircularProgress,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import { useLead, useLeadTimeline } from "./hooks.js";

/**
 * Página de detalhe de um lead.
 *
 * @returns O painel de detalhe.
 */
export function LeadDetailPage(): JSX.Element {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { data: lead, isLoading } = useLead(id);
  const { data: timeline } = useLeadTimeline(id);

  if (isLoading || !lead) {
    return (
      <Box sx={{ display: "grid", placeItems: "center", height: 240 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      <Button startIcon={<ArrowBackIcon />} onClick={() => navigate("/crm")} sx={{ mb: 2 }}>
        Voltar ao pipeline
      </Button>

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 6 }}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Contato
              </Typography>
              <Typography><strong>Nome:</strong> {lead.person.full_name ?? "—"}</Typography>
              <Typography><strong>E-mail:</strong> {lead.person.email ?? "—"}</Typography>
              <Typography><strong>Telefone:</strong> {lead.person.phone ?? "—"}</Typography>
              {lead.company && (
                <>
                  <Divider sx={{ my: 1 }} />
                  <Typography><strong>Empresa:</strong> {lead.company.legal_name ?? "—"}</Typography>
                  <Typography><strong>Documento:</strong> {lead.company.fiscal_document ?? "—"}</Typography>
                </>
              )}
              <Divider sx={{ my: 1 }} />
              <Typography><strong>Etapa:</strong> {lead.column_id}</Typography>
              <Typography><strong>Status:</strong> {lead.status}</Typography>
            </CardContent>
          </Card>
        </Grid>

        <Grid size={{ xs: 12, md: 6 }}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Histórico
              </Typography>
              <List dense>
                {(timeline ?? []).map((entry, i) => (
                  <ListItem key={i} disableGutters>
                    <ListItemText
                      primary={entry.text}
                      secondary={`${entry.user_name ?? "SYSTEM"} — ${new Date(entry.timestamp).toLocaleString("pt-BR")}`}
                    />
                  </ListItem>
                ))}
                {(timeline ?? []).length === 0 && (
                  <Typography color="text.secondary">Sem eventos ainda.</Typography>
                )}
              </List>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
}
