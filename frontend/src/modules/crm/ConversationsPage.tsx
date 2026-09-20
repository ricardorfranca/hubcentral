/**
 * @file ConversationsPage.tsx
 * @module modules/crm
 *
 * Tela de conversas do CRM 2.0. Lista as conversas do usuário (equipe + DMs)
 * com contagem de não lidas; ao abrir uma conversa, exibe as mensagens, permite
 * enviar e marca como lida.
 */

import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Box, Typography, Paper, Stack, TextField, IconButton, List, ListItem, ListItemButton,
  ListItemText, CircularProgress, Badge, Divider, Grid2 as Grid,
} from "@mui/material";
import SendIcon from "@mui/icons-material/Send";
import { listMessages, sendMessage } from "../../core/api/crm-extra.js";
import { useConversations, useMarkConversationRead } from "./sales-hooks.js";
import { dateTime } from "./format.js";

/** Canal padrão da equipe. */
const GROUP = "group";

/**
 * Página de conversas do CRM.
 *
 * @returns A tela de conversas.
 */
export function ConversationsPage(): JSX.Element {
  const qc = useQueryClient();
  const { data: conversations, isLoading: loadingList } = useConversations();
  const markRead = useMarkConversationRead();
  const [selected, setSelected] = useState<string>(GROUP);
  const [text, setText] = useState("");

  const { data: messages, isLoading: loadingMsgs } = useQuery({
    queryKey: ["crm", "messages", selected],
    queryFn: () => listMessages(selected),
    refetchInterval: 10_000,
    enabled: Boolean(selected),
  });

  // Ao selecionar uma conversa, marca como lida.
  useEffect(() => {
    if (selected) markRead.mutate(selected);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  const send = useMutation({
    mutationFn: () => sendMessage(selected, text),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["crm", "messages", selected] });
      qc.invalidateQueries({ queryKey: ["crm2", "conversations"] });
      setText("");
    },
  });

  // Garante que a conversa da equipe apareça mesmo sem histórico.
  const list = conversations ?? [];
  const hasGroup = list.some((c) => c.conversation_id === GROUP);
  const rows = hasGroup ? list : [{ conversation_id: GROUP, last_text: null, last_at: null, unread: 0 }, ...list];

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 2 }}>Conversas</Typography>
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 4 }}>
          <Paper variant="outlined">
            {loadingList ? (
              <Box sx={{ display: "grid", placeItems: "center", height: 160 }}><CircularProgress /></Box>
            ) : (
              <List disablePadding>
                {rows.map((c) => (
                  <ListItemButton
                    key={c.conversation_id}
                    selected={c.conversation_id === selected}
                    onClick={() => setSelected(c.conversation_id)}
                  >
                    <ListItemText
                      primary={c.conversation_id === GROUP ? "Equipe" : c.conversation_id}
                      secondary={c.last_text ?? "Sem mensagens"}
                    />
                    {c.unread > 0 && <Badge color="primary" badgeContent={c.unread} />}
                  </ListItemButton>
                ))}
              </List>
            )}
          </Paper>
        </Grid>

        <Grid size={{ xs: 12, md: 8 }}>
          <Paper variant="outlined" sx={{ p: 2 }}>
            {loadingMsgs ? (
              <Box sx={{ display: "grid", placeItems: "center", height: 160 }}><CircularProgress /></Box>
            ) : (
              <List sx={{ maxHeight: 420, overflowY: "auto" }}>
                {(messages ?? []).map((m) => (
                  <ListItem key={m.id} disableGutters>
                    <ListItemText
                      primary={m.text}
                      secondary={`${m.from_user_name ?? "Sistema"} — ${dateTime(m.timestamp)}`}
                    />
                  </ListItem>
                ))}
                {(messages ?? []).length === 0 && <Typography color="text.secondary">Sem mensagens ainda.</Typography>}
              </List>
            )}
            <Divider sx={{ my: 1 }} />
            <Stack direction="row" spacing={1}>
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
        </Grid>
      </Grid>
    </Box>
  );
}
