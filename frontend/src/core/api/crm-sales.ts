/**
 * @file crm-sales.ts
 * @module core/api
 *
 * Funções tipadas do CRM 2.0 (Receita Previsível): contas, oportunidades,
 * estágios, atividades, forecast e conversas.
 */

import { request } from "./client.js";
import type { CompanyFields } from "./contacts.js";

export type Origin = "inbound" | "outbound" | "indicacao";
export type Qualification = "frio" | "morno" | "quente";

export interface Account {
  id: string;
  company_contact_id: string;
  segment: string | null;
  size_tier: string | null;
  owner_user_id: string | null;
  legal_name?: string | null;
  cnpj?: string | null;
}

export interface AccountView extends Account {
  contacts: { person_contact_id: string; full_name: string | null; role: string | null }[];
}

export interface Opportunity {
  id: string;
  account_id: string;
  name: string;
  stage_id: string;
  probability: number;
  mrr: string;
  one_time: string;
  origin: Origin | null;
  qualification: Qualification | null;
  owner_user_id: string | null;
  status: "open" | "won" | "lost";
  loss_reason: string | null;
  primary_contact_id: string | null;
  account_name?: string | null;
  primary_contact_name?: string | null;
  arr?: number;
}

export interface Stage {
  id: string;
  label: string;
  position: number;
  probability: number;
  terminal: boolean;
  won_lost: "won" | "lost" | null;
}

export interface Activity {
  id: string;
  opportunity_id: string | null;
  type: "ligacao" | "email" | "reuniao" | "tarefa" | "nota";
  subject: string;
  notes: string | null;
  assigned_to: string | null;
  due_at: string | null;
  status: "pendente" | "concluida";
}

export interface Forecast {
  weighted: { weighted: number; open_mrr: number; open_count: number };
  period: { new_mrr: number; new_arr: number; one_time_total: number; won_count: number };
  by_stage: { stage_id: string; label: string; count: number }[];
  by_origin: { origin: string | null; count: number; mrr: number }[];
  by_owner: { owner_user_id: string | null; count: number; weighted: number }[];
}

export interface Conversation {
  conversation_id: string;
  last_text: string | null;
  last_at: string | null;
  unread: number;
}

// --- Contas ---

/** Lista todas as contas (empresas B2B). */
export function listAccounts(): Promise<AccountView[]> {
  return request<AccountView[]>("/api/crm/accounts");
}

/** Busca uma conta com seus contatos vinculados. */
export function getAccount(id: string): Promise<AccountView> {
  return request<AccountView>(`/api/crm/accounts/${id}`);
}

/**
 * Cria uma conta a partir de razão social + CNPJ.
 *
 * `company` leva os dados cadastrais oficiais obtidos no autofill de CNPJ
 * (cidade, UF, telefone…). Eles só são gravados se a empresa ainda não existir
 * na Base Central — o CRM não sobrescreve cadastro existente.
 */
export function createAccount(input: {
  legal_name: string;
  cnpj: string;
  segment?: string | undefined;
  size_tier?: string | undefined;
  company?: Partial<CompanyFields> | undefined;
}): Promise<Account> {
  return request<Account>("/api/crm/accounts", { method: "POST", body: input });
}

/** Vincula um contato pessoa a uma conta, com papel opcional. */
export function linkContact(accountId: string, personContactId: string, role?: string | undefined): Promise<void> {
  return request<void>(`/api/crm/accounts/${accountId}/contacts`, {
    method: "POST",
    body: { person_contact_id: personContactId, role },
  });
}

// --- Oportunidades ---

/** Filtros de listagem de oportunidades. */
export interface OpportunityFilters {
  status?: "open" | "won" | "lost";
  stage_id?: string;
  account_id?: string;
  owner_user_id?: string;
}

/** Lista oportunidades aplicando filtros opcionais. */
export function listOpportunities(filters: OpportunityFilters = {}): Promise<Opportunity[]> {
  const params = new URLSearchParams();
  if (filters.status) params.set("status", filters.status);
  if (filters.stage_id) params.set("stage_id", filters.stage_id);
  if (filters.account_id) params.set("account_id", filters.account_id);
  if (filters.owner_user_id) params.set("owner_user_id", filters.owner_user_id);
  const qs = params.toString();
  return request<Opportunity[]>(`/api/crm/opportunities${qs ? `?${qs}` : ""}`);
}

/** Busca uma oportunidade pelo id. */
export function getOpportunity(id: string): Promise<Opportunity> {
  return request<Opportunity>(`/api/crm/opportunities/${id}`);
}

/** Cria uma oportunidade em uma conta. */
export function createOpportunity(input: {
  account_id: string;
  name: string;
  primary_contact_id: string;
  mrr?: number | undefined;
  one_time?: number | undefined;
  origin?: Origin | undefined;
  qualification?: Qualification | undefined;
  stage_id?: string | undefined;
  expected_close?: string | undefined;
}): Promise<Opportunity> {
  return request<Opportunity>("/api/crm/opportunities", { method: "POST", body: input });
}

/** Move uma oportunidade para outro estágio. */
export function moveStage(id: string, stageId: string): Promise<Opportunity> {
  return request<Opportunity>(`/api/crm/opportunities/${id}/stage`, {
    method: "PATCH",
    body: { stage_id: stageId },
  });
}

/** Finaliza uma oportunidade como ganha ou perdida. */
export function finalizeOpportunity(
  id: string,
  outcome: "won" | "lost",
  extra: { mrr?: number | undefined; one_time?: number | undefined; loss_reason?: string | undefined } = {},
): Promise<Opportunity> {
  return request<Opportunity>(`/api/crm/opportunities/${id}/finalize`, {
    method: "PATCH",
    body: { outcome, ...extra },
  });
}

// --- Estágios ---

/** Lista os estágios do pipeline, ordenados por posição. */
export function listStages(): Promise<Stage[]> {
  return request<Stage[]>("/api/crm/stages");
}

/** Atualiza rótulo e/ou probabilidade de um estágio. */
export function updateStage(id: string, patch: { label?: string; probability?: number }): Promise<Stage> {
  return request<Stage>(`/api/crm/stages/${id}`, { method: "PATCH", body: patch });
}

// --- Forecast ---

/** Retorna os agregados de Receita Previsível do período corrente. */
export function getForecast(): Promise<Forecast> {
  return request<Forecast>("/api/crm/forecast");
}

// --- Atividades ---

/** Lista as atividades atribuídas ao usuário autenticado. */
export function listMyActivities(): Promise<Activity[]> {
  return request<Activity[]>("/api/crm/activities/mine");
}

/** Lista as atividades de uma oportunidade. */
export function listOpportunityActivities(opportunityId: string): Promise<Activity[]> {
  return request<Activity[]>(`/api/crm/opportunities/${opportunityId}/activities`);
}

/** Cria uma atividade (ligação, e-mail, reunião, tarefa ou nota). */
export function createActivity(input: {
  type: Activity["type"];
  subject: string;
  notes?: string | undefined;
  opportunity_id?: string | undefined;
  account_id?: string | undefined;
  person_contact_id?: string | undefined;
  due_at?: string | undefined;
}): Promise<Activity> {
  return request<Activity>("/api/crm/activities", { method: "POST", body: input });
}

/** Marca uma atividade como concluída. */
export function completeActivity(id: string): Promise<Activity> {
  return request<Activity>(`/api/crm/activities/${id}/complete`, { method: "POST" });
}

// --- Conversas ---

/** Lista as conversas do usuário com contagem de não lidas. */
export function listConversations(): Promise<Conversation[]> {
  return request<Conversation[]>("/api/crm/conversations");
}

/** Marca uma conversa como lida. */
export function markConversationRead(conversationId: string): Promise<void> {
  return request<void>(`/api/crm/conversations/${conversationId}/read`, { method: "POST" });
}
