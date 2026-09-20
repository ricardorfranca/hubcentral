/**
 * @file ActivitiesPage.tsx
 * @module modules/crm
 *
 * Agenda de atividades do usuário (cadência de vendas): tarefas pendentes
 * ordenadas por prazo, com ação de concluir.
 */

import {
  Box, Typography, Paper, List, ListItem, ListItemText, Checkbox, CircularProgress, Chip, Stack,
} from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import { useMyActivities, useCompleteActivity } from "./sales-hooks.js";
import { useCan } from "../../core/rbac/can.js";
import { dateTime, ACTIVITY_LABELS } from "./format.js";

/**
 * Página de agenda de atividades do usuário.
 *
 * @returns A tela de atividades.
 */
export function ActivitiesPage(): JSX.Element {
  const can = useCan();
  const canManage = can("crm:atividades:gerenciar");
  const { data: activities, isLoading } = useMyActivities();
  const complete = useCompleteActivity();

  if (isLoading) {
    return <Box sx={{ display: "grid", placeItems: "center", height: 200 }}><CircularProgress /></Box>;
  }

  const now = Date.now();

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 2 }}>Minhas atividades</Typography>
      <Paper variant="outlined" sx={{ maxWidth: 720 }}>
        <List>
          {(activities ?? []).map((a) => {
            const overdue = a.due_at ? new Date(a.due_at).getTime() < now : false;
            return (
              <ListItem
                key={a.id}
                secondaryAction={
                  canManage ? (
                    <Checkbox
                      icon={<CheckCircleIcon color="disabled" />}
                      checkedIcon={<CheckCircleIcon color="success" />}
                      onChange={() => complete.mutate(a.id)}
                      disabled={complete.isPending}
                    />
                  ) : undefined
                }
              >
                <ListItemText
                  primary={
                    <Stack direction="row" spacing={1} alignItems="center">
                      <span>{ACTIVITY_LABELS[a.type] ?? a.type}: {a.subject}</span>
                      {overdue && <Chip size="small" color="error" label="Atrasada" />}
                    </Stack>
                  }
                  secondary={a.due_at ? `Prazo: ${dateTime(a.due_at)}` : "Sem prazo"}
                />
              </ListItem>
            );
          })}
          {(activities ?? []).length === 0 && (
            <ListItem><ListItemText primary="Nenhuma atividade pendente." /></ListItem>
          )}
        </List>
      </Paper>
    </Box>
  );
}
