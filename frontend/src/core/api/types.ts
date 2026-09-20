/**
 * @file types.ts
 * @module core/api
 *
 * Tipos que espelham os contratos da API do HUB Central (backend). Mantidos em
 * sincronia manual com os serviços do backend.
 */

/** Erro de domínio propagado pela API: `{ code, message, details }`. */
export interface ApiErrorBody {
  code: string;
  message: string;
  details: Record<string, unknown>;
}

/** Papéis de usuário (IAM). */
export type UserRole = "superadmin" | "module_admin" | "operator" | "client";

/** Usuário autenticado (subconjunto seguro). */
export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
  password_set: boolean;
}

/** Resposta do login. */
export interface LoginResponse {
  token: string;
  expires_at: string;
  user: AuthUser;
  permissions: string[];
  must_change_password: boolean;
}

/** Lead do CRM (formato de referência de contatos). */
export interface Lead {
  id: string;
  person_contact_id: string;
  company_contact_id: string | null;
  assigned_to: string | null;
  column_id: string;
  status: "active" | "won" | "lost" | "discarded";
  /** Nome do contato pessoa, resolvido da Base Central (na listagem). */
  person_name?: string | null;
  /** Nome da empresa, resolvido da Base Central (na listagem). */
  company_name?: string | null;
}

/** Visão de lead com dados de contato resolvidos da Base Central. */
export interface LeadView {
  id: string;
  column_id: string;
  status: string;
  person: { contact_id: string; full_name: string | null; email: string | null; phone: string | null };
  company: { contact_id: string; legal_name: string | null; fiscal_document: string | null } | null;
}

/** Entrada da timeline do lead. */
export interface TimelineEntry {
  action_type: string;
  text: string;
  user_name: string | null;
  timestamp: string;
}

/** Item de lista configurável do CRM. */
export interface ListItem {
  id: string;
  type: string;
  value: string;
  active: boolean;
}

/** Configuração de SLA de uma etapa. */
export interface SlaConfig {
  column_id: string;
  value: number;
  unit: "minutes" | "hours" | "days";
}

/** Campanha do CRM. */
export interface Campaign {
  id: string;
  name: string;
  tags: string[];
  channels: string[];
  status: "draft" | "active" | "paused";
  subject: string | null;
  body_type: "text" | "html";
  body_text: string | null;
  body_html: string | null;
}

/** Mensagem da mensageria interna. */
export interface Message {
  id: string;
  from_user_id: string | null;
  from_user_name: string | null;
  conversation_id: string;
  text: string;
  type: "message" | "sla_alert" | "system";
  lead_id: string | null;
  timestamp: string;
}

/** Relatório de fechamentos do mês. */
export interface ClosingsReport {
  won: number;
  lost: number;
  total_activation: number;
  total_monthly: number;
}

/** Relatório de cumprimento de SLA. */
export interface SlaReport {
  overdue: number;
  on_time: number;
}

/** Item de performance por vendedor. */
export interface PerformanceRow {
  assigned_to: string | null;
  total: number;
  won: number;
  lost: number;
}

/** Item de motivos de perda. */
export interface LossReasonRow {
  loss_reason: string | null;
  count: number;
}
