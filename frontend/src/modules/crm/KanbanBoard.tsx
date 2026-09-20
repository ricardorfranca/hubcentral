/**
 * @file KanbanBoard.tsx
 * @module modules/crm
 *
 * Pipeline Kanban do CRM. Exibe colunas por etapa ativa, permite mover leads
 * por drag-and-drop (desabilitado sem `crm:pipeline:mover`) e criar leads.
 */

import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Box, Paper, Typography, Card, CardActionArea, CardContent, Button, Stack, CircularProgress,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import { ACTIVE_STAGES } from "./pipeline.js";
import { useLeads, useMoveLead } from "./hooks.js";
import { useCan } from "../../core/rbac/can.js";
import { NewLeadDialog } from "./NewLeadDialog.js";
import type { Lead } from "../../core/api/types.js";

/**
 * Board Kanban do pipeline de leads.
 *
 * @returns O quadro Kanban.
 */
export function KanbanBoard(): JSX.Element {
  const navigate = useNavigate();
  const can = useCan();
  const canMove = can("crm:pipeline:mover");
  const { data: leads, isLoading } = useLeads();
  const moveLead = useMoveLead();
  const [dialogOpen, setDialogOpen] = useState(false);

  // Agrupa leads por etapa.
  const byColumn = useMemo(() => {
    const map = new Map<string, Lead[]>();
    for (const stage of ACTIVE_STAGES) map.set(stage.id, []);
    for (const lead of leads ?? []) {
      if (!map.has(lead.column_id)) map.set(lead.column_id, []);
      map.get(lead.column_id)!.push(lead);
    }
    return map;
  }, [leads]);

  function onDrop(columnId: string, e: React.DragEvent): void {
    e.preventDefault();
    const leadId = e.dataTransfer.getData("text/lead-id");
    if (leadId && canMove) {
      moveLead.mutate({ id: leadId, toColumn: columnId });
    }
  }

  if (isLoading) {
    return (
      <Box sx={{ display: "grid", placeItems: "center", height: 240 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Typography variant="h5">Pipeline</Typography>
        <Button startIcon={<AddIcon />} variant="contained" onClick={() => setDialogOpen(true)}>
          Novo lead
        </Button>
      </Stack>

      <Box sx={{ display: "flex", gap: 2, overflowX: "auto", pb: 1 }}>
        {ACTIVE_STAGES.map((stage) => (
          <Paper
            key={stage.id}
            variant="outlined"
            sx={{ minWidth: 260, width: 260, p: 1, bgcolor: "grey.50" }}
            onDragOver={(e) => canMove && e.preventDefault()}
            onDrop={(e) => onDrop(stage.id, e)}
          >
            <Typography variant="subtitle2" sx={{ px: 1, py: 0.5 }}>
              {stage.label} ({byColumn.get(stage.id)?.length ?? 0})
            </Typography>
            <Stack spacing={1}>
              {(byColumn.get(stage.id) ?? []).map((lead) => (
                <Card
                  key={lead.id}
                  draggable={canMove}
                  onDragStart={(e) => e.dataTransfer.setData("text/lead-id", lead.id)}
                  sx={{ cursor: canMove ? "grab" : "pointer" }}
                >
                  <CardActionArea onClick={() => navigate(`/crm/leads/${lead.id}`)}>
                    <CardContent sx={{ py: 1.5 }}>
                      <Typography variant="body2" fontWeight={600}>
                        {lead.person_name || `Lead ${lead.id.slice(0, 8)}`}
                      </Typography>
                      {lead.company_name && (
                        <Typography variant="caption" display="block" color="text.secondary">
                          {lead.company_name}
                        </Typography>
                      )}
                      <Typography variant="caption" color="text.secondary">
                        {lead.status}
                      </Typography>
                    </CardContent>
                  </CardActionArea>
                </Card>
              ))}
            </Stack>
          </Paper>
        ))}
      </Box>

      <NewLeadDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </Box>
  );
}
