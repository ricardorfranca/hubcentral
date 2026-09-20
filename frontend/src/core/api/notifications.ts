/**
 * @file notifications.ts
 * @module core/api
 *
 * Cliente tipado da Central de Notificações in-app (núcleo).
 */

import { request } from "./client.js";

/** Notificação in-app. */
export interface Notification {
  id: string;
  module: string;
  type: string;
  message: string;
  entity_type: string | null;
  entity_id: string | null;
  link: string | null;
  read: boolean;
  created_at: string;
  read_at: string | null;
}

/** Lista as notificações do usuário (opcionalmente só não lidas). */
export function listNotifications(unreadOnly = false): Promise<Notification[]> {
  return request<Notification[]>(`/api/notifications${unreadOnly ? "?unread=1" : ""}`);
}

/** Retorna o contador de notificações não lidas. */
export function unreadCount(): Promise<{ count: number }> {
  return request<{ count: number }>("/api/notifications/unread-count");
}

/** Marca uma notificação como lida. */
export function markRead(id: string): Promise<Notification> {
  return request<Notification>(`/api/notifications/${id}/read`, { method: "POST" });
}

/** Marca todas as notificações como lidas. */
export function markAllRead(): Promise<{ marked: number }> {
  return request<{ marked: number }>("/api/notifications/read-all", { method: "POST" });
}
