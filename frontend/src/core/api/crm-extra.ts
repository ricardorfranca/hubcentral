/**
 * @file crm-extra.ts
 * @module core/api
 *
 * Funções tipadas dos recursos adicionais do CRM: listas, SLA, campanhas,
 * mensageria e relatórios.
 */

import { request } from "./client.js";
import type {
  ListItem, SlaConfig, Campaign, Message,
  ClosingsReport, SlaReport, PerformanceRow, LossReasonRow,
} from "./types.js";

/** Tipos de lista configurável. */
export type CrmListType = "tag" | "source" | "product" | "partner" | "loss_reason";
/** Canais de campanha. */
export type CrmChannel = "email" | "whatsapp" | "sms";

// --- Listas ---
export function listCrmItems(type: CrmListType): Promise<ListItem[]> {
  return request<ListItem[]>(`/api/crm/lists/${type}`);
}
export function addCrmItem(type: CrmListType, value: string): Promise<ListItem> {
  return request<ListItem>(`/api/crm/lists/${type}`, { method: "POST", body: { value } });
}
export function removeCrmItem(type: CrmListType, id: string): Promise<void> {
  return request<void>(`/api/crm/lists/${type}/${id}`, { method: "DELETE" });
}

// --- SLA ---
export function getSla(columnId: string): Promise<SlaConfig> {
  return request<SlaConfig>(`/api/crm/sla/${columnId}`);
}
export function setSla(columnId: string, value: number, unit: SlaConfig["unit"]): Promise<void> {
  return request<void>(`/api/crm/sla/${columnId}`, { method: "PUT", body: { value, unit } });
}

// --- Campanhas ---
export function listCampaigns(): Promise<Campaign[]> {
  return request<Campaign[]>("/api/crm/campaigns");
}
export function createCampaign(payload: {
  name: string; tags: string[]; channels: CrmChannel[]; subject?: string | undefined; body_type?: "text" | "html" | undefined; body_text?: string | undefined; body_html?: string | undefined;
}): Promise<Campaign> {
  return request<Campaign>("/api/crm/campaigns", { method: "POST", body: payload });
}
export function updateCampaign(id: string, patch: {
  name?: string | undefined; tags?: string[] | undefined; channels?: CrmChannel[] | undefined; status?: "draft" | "active" | "paused" | undefined; subject?: string | undefined; body_type?: "text" | "html" | undefined; body_text?: string | undefined; body_html?: string | undefined;
}): Promise<Campaign> {
  return request<Campaign>(`/api/crm/campaigns/${id}`, { method: "PATCH", body: patch });
}
export function dispatchCampaign(id: string, channel: CrmChannel, categoryIds: string[]): Promise<{ lead_count: number; delivered: number; failed: number }> {
  return request<{ lead_count: number; delivered: number; failed: number }>(`/api/crm/campaigns/${id}/dispatch`, {
    method: "POST",
    body: { channel, category_ids: categoryIds },
  });
}

// --- Mensageria ---
export function listMessages(conversationId: string): Promise<Message[]> {
  return request<Message[]>(`/api/crm/messages/${conversationId}`);
}
export function sendMessage(conversationId: string, text: string): Promise<Message> {
  return request<Message>("/api/crm/messages", { method: "POST", body: { conversation_id: conversationId, text } });
}

// --- Relatórios ---
export function reportClosings(): Promise<ClosingsReport> {
  return request<ClosingsReport>("/api/crm/reports/closings");
}
export function reportSla(): Promise<SlaReport> {
  return request<SlaReport>("/api/crm/reports/sla");
}
export function reportPerformance(): Promise<PerformanceRow[]> {
  return request<PerformanceRow[]>("/api/crm/reports/performance");
}
export function reportLossReasons(): Promise<LossReasonRow[]> {
  return request<LossReasonRow[]>("/api/crm/reports/loss-reasons");
}
