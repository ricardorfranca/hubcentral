/**
 * @file contacts.ts
 * @module core/api
 *
 * Cliente tipado da Base Central de Contatos: listagem (com rótulos), criação/
 * edição de pessoas e empresas, e gestão de rótulos (categorias).
 */

import { request } from "./client.js";

/** Rótulo (categoria) de contato. */
export interface ContactLabel {
  id: string;
  name: string;
  is_system?: boolean;
}

/** Contato da Base Central. */
export interface Contact {
  id: string;
  contact_type: "pessoa" | "empresa";
  full_name: string | null;
  email: string | null;
  phone: string | null;
  legal_name: string | null;
  fiscal_document: string | null;
  created_at: string;
  updated_at: string;
}

/** Contato com rótulos resolvidos (listagem). */
export interface ContactListItem extends Contact {
  labels: ContactLabel[];
}

/** Lista contatos, filtrando por tipo e/ou texto. */
export function listContacts(params: { type?: "pessoa" | "empresa" | undefined; search?: string | undefined } = {}): Promise<ContactListItem[]> {
  const qs = new URLSearchParams();
  if (params.type) qs.set("type", params.type);
  if (params.search) qs.set("search", params.search);
  const s = qs.toString();
  return request<ContactListItem[]>(`/api/contacts${s ? `?${s}` : ""}`);
}

/** Cria uma pessoa. */
export function createPerson(input: { full_name: string; email: string; phone: string }): Promise<Contact> {
  return request<Contact>("/api/contacts", { method: "POST", body: { contact_type: "pessoa", ...input } });
}

/** Cria uma empresa. */
export function createCompany(input: { legal_name: string; fiscal_document: string }): Promise<Contact> {
  return request<Contact>("/api/contacts", { method: "POST", body: { contact_type: "empresa", ...input } });
}

/** Atualiza um contato. */
export function updateContact(id: string, patch: Partial<Pick<Contact, "full_name" | "email" | "phone" | "legal_name" | "fiscal_document">>): Promise<Contact> {
  return request<Contact>(`/api/contacts/${id}`, { method: "PATCH", body: patch });
}

/** Exclui um contato (bloqueado se referenciado por módulos). */
export function deleteContact(id: string): Promise<void> {
  return request<void>(`/api/contacts/${id}`, { method: "DELETE" });
}

// --- Rótulos (categorias) ---

/** Lista os rótulos disponíveis. */
export function listLabels(): Promise<ContactLabel[]> {
  return request<ContactLabel[]>("/api/contacts/categories");
}

/** Cria um rótulo customizado. */
export function createLabel(name: string): Promise<ContactLabel> {
  return request<ContactLabel>("/api/contacts/categories", { method: "POST", body: { name } });
}

/** Aplica um rótulo a um contato. */
export function assignLabel(contactId: string, categoryId: string): Promise<void> {
  return request<void>(`/api/contacts/${contactId}/labels`, { method: "POST", body: { category_id: categoryId } });
}

/** Remove um rótulo de um contato. */
export function unassignLabel(contactId: string, categoryId: string): Promise<void> {
  return request<void>(`/api/contacts/${contactId}/labels/${categoryId}`, { method: "DELETE" });
}
