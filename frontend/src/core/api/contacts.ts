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

/** Dados oficiais de um CNPJ (autofill). */
export interface CnpjData {
  cnpj: string;
  legal_name: string | null;
  trade_name: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
  status: string | null;
}

/** Consulta dados oficiais de um CNPJ para pré-preencher o cadastro. */
export async function lookupCnpj(cnpj: string): Promise<CnpjData | null> {
  const digits = cnpj.replace(/\D/g, "");
  if (digits.length !== 14) return null;
  try {
    return await request<CnpjData>(`/api/contacts/cnpj/${digits}`);
  } catch {
    return null;
  }
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

// --- Campos personalizados ---

/** Tipo de dado de um campo personalizado. */
export type CustomFieldDataType = "text" | "number" | "boolean" | "date";

/** Definição de um campo personalizado. */
export interface CustomFieldDef {
  id: string;
  name: string;
  data_type: CustomFieldDataType;
  created_at: string;
}

/** Valor de um campo personalizado de um contato (com metadados da definição). */
export interface CustomFieldValue {
  field_id: string;
  name: string;
  data_type: CustomFieldDataType;
  value: unknown;
}

/** Lista as definições de campos personalizados. */
export function listCustomFieldDefs(): Promise<CustomFieldDef[]> {
  return request<CustomFieldDef[]>("/api/custom-fields");
}

/** Cria uma definição de campo personalizado (admin). */
export function createCustomFieldDef(name: string, dataType: CustomFieldDataType): Promise<CustomFieldDef> {
  return request<CustomFieldDef>("/api/custom-fields", { method: "POST", body: { name, data_type: dataType } });
}

/** Remove uma definição de campo personalizado (e seus valores). */
export function deleteCustomFieldDef(fieldId: string): Promise<void> {
  return request<void>(`/api/custom-fields/${fieldId}`, { method: "DELETE" });
}

/** Lista os valores de campos personalizados de um contato. */
export function listContactCustomFields(contactId: string): Promise<CustomFieldValue[]> {
  return request<CustomFieldValue[]>(`/api/contacts/${contactId}/custom-fields`);
}

/** Define/atualiza o valor de um campo personalizado de um contato. */
export function setContactCustomField(contactId: string, fieldId: string, value: unknown): Promise<void> {
  return request<void>(`/api/contacts/${contactId}/custom-fields/${fieldId}`, { method: "PUT", body: { value } });
}

/** Remove o valor de um campo personalizado de um contato. */
export function clearContactCustomField(contactId: string, fieldId: string): Promise<void> {
  return request<void>(`/api/contacts/${contactId}/custom-fields/${fieldId}`, { method: "DELETE" });
}
