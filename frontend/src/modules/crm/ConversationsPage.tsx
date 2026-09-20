/**
 * @file ConversationsPage.tsx
 * @module modules/crm
 *
 * Tela de conversas: canal da equipe (`group`) com listagem e envio de
 * mensagens.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Box, Typography, Paper, Stack, TextField, IconButton, List, ListItem, ListItemText, CircularProgress,
} from "@mui/material";
import SendIcon from "@mui/icons-material/Send";
import { listMessages, sendMessage } from "../../core/api/crm-extra.js";

/** Canal da equipe. */
const GROUP = "group";

/**
 * Página de conversas (canal da equipe) do CRM.
 *
 * @returns A tela de conversas.
 */
export function ConversationsPage(): JSX.Element {
  const qc = useQueryClient();
  const { data: messages, isLoading } = useQuery({
    queryKey: ["crm", "messages", GROUP],
    queryFn: () => listMessages(GROUP),
    refetchInterval: 10_000,
  });
  const [text, setText] = useState("");

  const send = useMutation({
    mutationFn: () => sendMessage(GROUP, text),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["crm", "messages", GROUP] });
      setText("");
    },
  });

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 2 }}>Conversas — Equipe</Typography>
      <Paper variant="outlined" sx={{ p: 2, maxWidth: 720 }}>
        {isLoading ? (
          <Box sx={{ display: "grid", placeItems: "center", height: 160 }}><CircularProgress /></Box>
        ) : (
          <List sx={{ maxHeight: 420, overflowY: "auto" }}>
            {(messages ?? []).map((m) => (
              <ListItem key={m.id} disableGutters>
                <ListItemText
                  primary={m.text}
                  secondary={`${m.from_user_name ?? "Sistema"} — ${new Date(m.timestamp).toLocaleString("pt-BR")}`}
                />
              </ListItem>
            ))}
            {(messages ?? []).length === 0 && <Typography color="text.secondary">Sem mensagens ainda.</Typography>}
          </List>
        )}
        <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
          <TextField
            fullWidth
            size="small"
            placeholder="Escreva uma mensagem..."
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && text.trim()) send.mutate();
            }}
          />
          <IconButton color="primary" onClick={() => text.trim() && send.mutate()} disabled={send.isPending}>
            <SendIcon />
          </IconButton>
        </Stack>
      </Paper>
    </Box>
  );
}
