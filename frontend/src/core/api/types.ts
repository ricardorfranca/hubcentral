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
