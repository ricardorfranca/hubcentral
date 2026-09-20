/**
 * @file hooks.ts
 * @module core/notifications
 *
 * Hooks TanStack Query da Central de Notificações: contador (com polling),
 * lista e mutações de marcação de leitura.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { listNotifications, unreadCount, markRead, markAllRead } from "../api/notifications.js";

const keys = {
  count: ["notifications", "unread-count"] as const,
  list: (unreadOnly: boolean) => ["notifications", "list", unreadOnly] as const,
};

/** Contador de não lidas, com atualização periódica (30s). */
export function useUnreadCount() {
  return useQuery({
    queryKey: keys.count,
    queryFn: unreadCount,
    refetchInterval: 30_000,
    select: (d) => d.count,
  });
}

/** Lista de notificações. */
export function useNotifications(unreadOnly = false) {
  return useQuery({ queryKey: keys.list(unreadOnly), queryFn: () => listNotifications(unreadOnly) });
}

/** Marca uma notificação como lida; invalida lista e contador. */
export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => markRead(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
}

/** Marca todas como lidas; invalida lista e contador. */
export function useMarkAllRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: markAllRead,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
}
