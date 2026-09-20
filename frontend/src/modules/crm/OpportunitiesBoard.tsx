/**
 * @file OpportunitiesBoard.tsx
 * @module modules/crm
 *
 * Kanban de oportunidades do CRM 2.0. Colunas por estágio do pipeline; cartões
 * mostram conta, MRR e ARR. Drag-and-drop move de estágio (requer
 * `crm:oportunidades:mover`).
 */

import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Box, Paper, Typography, Card, CardActionArea, CardContent, Button, Stack, Chip,
  CircularProgress,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import { useOpportunities, useStages, useMoveStage } from "./sales-hooks.js";
import { useCan } from "../../core/rbac/can.js";
import { NewOpportunityDialog } from "./NewOpportunityDialog.js";
import { brl } from "./format.js";
import type { Opportunity } from "../../core/api/crm-sales.js";

/**
 * Board Kanban de oportunidades por estágio.
 *
 * @returns O quadro de oportunidades.
 */
export function OpportunitiesBoard(): JSX.Element {
  const navigate = useNavigate();
  const can = useCan();
  const canMove = can("crm:oportunidades:mover");
  const canCreate = can("crm:oportunidades:criar");

  const { data: stages, isLoading: loadingStages } = useStages();
  const { data: opps, isLoading: loadingOpps } = useOpportunities({ status: "open" });
  const moveStage = useMoveStage();
  const [dialogOpen, setDialogOpen] = useState(false);

  // Estágios não-terminais, ordenados.
  const activeStages = useMemo(
    () => (stages ?? []).filter((s) => !s.terminal).sort((a, b) => a.position - b.position),
    [stages],
  );

  // Agrupa oportunidades por estágio.
  const byStage = useMemo(() => {
    const map = new Map<string, Opportunity[]>();
    for (const s of activeStages) map.set(s.id, []);
    for (const o of opps ?? []) {
      if (!map.has(o.stage_id)) map.set(o.stage_id, []);
      map.get(o.stage_id)!.push(o);
    }
    return map;
  }, [opps, activeStages]);

  function onDrop(stageId: string, e: React.DragEvent): void {
    e.preventDefault();
    const id = e.dataTransfer.getData("text/opp-id");
    if (id && canMove) moveStage.mutate({ id, stageId });
  }

  if (loadingStages || loadingOpps) {
    return <Box sx={{ display: "grid", placeItems: "center", height: 240 }}><CircularProgress /></Box>;
  }

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Typography variant="h5">Oportunidades</Typography>
        {canCreate && (
          <Button startIcon={<AddIcon />} variant="contained" onClick={() => setDialogOpen(true)}>
            Nova oportunidade
          </Button>
        )}
      </Stack>

      <Box sx={{ display: "flex", gap: 2, overflowX: "auto", pb: 1 }}>
        {activeStages.map((stage) => {
          const items = byStage.get(stage.id) ?? [];
          const totalMrr = items.reduce((sum, o) => sum + Number(o.mrr), 0);
          return (
            <Paper
              key={stage.id}
              variant="outlined"
              sx={{
                minWidth: 280,
                width: 280,
                p: 1,
                // Fundo sensível ao modo: claro no light, escuro no dark, para
                // que o texto (text.primary/secondary) permaneça legível.
                bgcolor: (theme) => (theme.palette.mode === "dark" ? "grey.900" : "grey.50"),
              }}
              onDragOver={(e) => canMove && e.preventDefault()}
              onDrop={(e) => onDrop(stage.id, e)}
            >
              <Stack direction="row" justifyContent="space-between" sx={{ px: 1, py: 0.5 }}>
                <Typography variant="subtitle2" color="text.primary">
                  {stage.label} ({items.length})
                </Typography>
                <Chip size="small" label={`${stage.probability}%`} />
              </Stack>
              <Typography variant="caption" color="text.secondary" sx={{ px: 1 }}>
                MRR: {brl(totalMrr)}
              </Typography>
              <Stack spacing={1} sx={{ mt: 1 }}>
                {items.map((o) => (
                  <Card
                    key={o.id}
                    draggable={canMove}
                    onDragStart={(e) => e.dataTransfer.setData("text/opp-id", o.id)}
                    // Fundo e texto explicitamente derivados do tema para garantir
                    // contraste em ambos os modos (o texto herda text.primary).
                    sx={{
                      cursor: canMove ? "grab" : "pointer",
                      bgcolor: "background.paper",
                      color: "text.primary",
                    }}
                  >
                    <CardActionArea onClick={() => navigate(`/crm/oportunidades/${o.id}`)}>
                      <CardContent sx={{ py: 1.5 }}>
                        <Typography variant="body2" fontWeight={600} color="text.primary">{o.name}</Typography>
                        {o.account_name && (
                          <Typography variant="caption" display="block" color="text.secondary">
                            {o.account_name}
                          </Typography>
                        )}
                        <Typography variant="caption" display="block" color="text.primary">
                          MRR {brl(o.mrr)} · ARR {brl(o.arr ?? Number(o.mrr) * 12)}
                        </Typography>
                        {o.qualification && (
                          <Chip size="small" label={o.qualification} sx={{ mt: 0.5 }} />
                        )}
                      </CardContent>
                    </CardActionArea>
                  </Card>
                ))}
                {items.length === 0 && (
                  <Typography variant="caption" color="text.secondary" sx={{ px: 1 }}>
                    Nenhuma oportunidade.
                  </Typography>
                )}
              </Stack>
            </Paper>
          );
        })}
      </Box>

      <NewOpportunityDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </Box>
  );
}
