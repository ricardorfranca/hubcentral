/**
 * @file crm.ts
 * @module core/api
 *
 * Funções tipadas dos endpoints do módulo CRM.
 */

import { request } from "./client.js";
import type { Lead, LeadView, TimelineEntry } from "./types.js";

/** Entrada para criar um lead. */
export interface CreateLeadPayload {
  person: { full_name: string; email: string; phone: string };
  company?: { legal_name: string; fiscal_document: string };
  assignedTo?: string;
  columnId?: string;
}

/**
 * Lista os leads (visões com dados de contato resolvidos).
 *
 * @returns Lista de leads.
 */
export function listLeads(): Promise<Lead[]> {
  return request<Lead[]>("/api/crm/leads");
}

/**
 * Obtém a visão detalhada de um lead.
 *
 * @param id - `id` do lead.
 * @returns A visão do lead.
 */
export function getLead(id: string): Promise<LeadView> {
  return request<LeadView>(`/api/crm/leads/${id}`);
}

/**
 * Cria um lead.
 *
 * @param payload - Dados do lead.
 * @returns O lead criado.
 */
export function createLead(payload: CreateLeadPayload): Promise<Lead> {
  return request<Lead>("/api/crm/leads", { method: "POST", body: payload });
}

/**
 * Move um lead para outra etapa do pipeline.
 *
 * @param id - `id` do lead.
 * @param toColumn - Etapa de destino.
 * @returns O lead atualizado.
 */
export function moveLead(id: string, toColumn: string): Promise<Lead> {
  return request<Lead>(`/api/crm/leads/${id}/move`, { method: "PATCH", body: { to_column: toColumn } });
}

/**
 * Obtém a timeline de um lead.
 *
 * @param id - `id` do lead.
 * @returns Entradas da timeline.
 */
export function getLeadTimeline(id: string): Promise<TimelineEntry[]> {
  return request<TimelineEntry[]>(`/api/crm/leads/${id}/timeline`);
}
