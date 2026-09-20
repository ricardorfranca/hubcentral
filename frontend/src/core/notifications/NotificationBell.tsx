/**
 * @file NotificationBell.tsx
 * @module core/notifications
 *
 * Sino de notificações do HUB Central, exibido no cabeçalho (AppBar). Mostra o
 * contador de não lidas e um popover com as notificações recentes; clicar em
 * uma notificação navega para seu `link` e a marca como lida. Componente do
 * núcleo — qualquer módulo produz notificações sem alterar o Shell.
 */

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  IconButton, Badge, Popover, List, ListItemButton, ListItemText, Typography, Box, Button, Divider,
} from "@mui/material";
import NotificationsIcon from "@mui/icons-material/Notifications";
import { useUnreadCount, useNotifications, useMarkRead, useMarkAllRead } from "./hooks.js";

/**
 * Ícone de sino com contador e lista de notificações.
 *
 * @returns O sino de notificações.
 */
export function NotificationBell(): JSX.Element {
  const navigate = useNavigate();
  const [anchor, setAnchor] = useState<null | HTMLElement>(null);
  const { data: count = 0 } = useUnreadCount();
  const { data: notifications = [] } = useNotifications();
  const markRead = useMarkRead();
  const markAll = useMarkAllRead();

  function open(e: React.MouseEvent<HTMLElement>): void {
    setAnchor(e.currentTarget);
  }
  function close(): void {
    setAnchor(null);
  }

  function handleClick(id: string, link: string | null): void {
    markRead.mutate(id);
    close();
    if (link) navigate(link);
  }

  return (
    <>
      <IconButton color="inherit" onClick={open} aria-label={`notificações (${count} não lidas)`}>
        <Badge badgeContent={count} color="error">
          <NotificationsIcon />
        </Badge>
      </IconButton>
      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={close}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
      >
        <Box sx={{ width: 360, maxWidth: "90vw" }}>
          <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", px: 2, py: 1 }}>
            <Typography variant="subtitle1" fontWeight={600}>Notificações</Typography>
            <Button size="small" onClick={() => markAll.mutate()} disabled={count === 0}>
              Marcar todas
            </Button>
          </Box>
          <Divider />
          <List sx={{ maxHeight: 400, overflowY: "auto", py: 0 }}>
            {notifications.length === 0 && (
              <ListItemText sx={{ px: 2, py: 2 }} primary={<Typography color="text.secondary">Sem notificações.</Typography>} />
            )}
            {notifications.map((n) => (
              <ListItemButton
                key={n.id}
                onClick={() => handleClick(n.id, n.link)}
                sx={{ bgcolor: n.read ? "transparent" : "action.hover" }}
              >
                <ListItemText
                  primary={n.message}
                  secondary={new Date(n.created_at).toLocaleString("pt-BR")}
                  primaryTypographyProps={{ fontWeight: n.read ? 400 : 600 }}
                />
              </ListItemButton>
            ))}
          </List>
        </Box>
      </Popover>
    </>
  );
}
