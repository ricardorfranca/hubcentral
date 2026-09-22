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

/**
 * Dados cadastrais complementares de uma empresa. Todos opcionais: o mínimo
 * para cadastrar segue sendo razão social + CNPJ.
 */
export interface CompanyFields {
  /** Cliente com contrato ativo (`true`) ou sem contrato ativo (`false`). */
  contract_active: boolean;
  /** Inscrição estadual (ou "ISENTO"). */
  state_tax_id: string | null;
  website: string | null;
  /** CEP em 8 dígitos, sem máscara. */
  zip_code: string | null;
  street_address: string | null;
  address_number: string | null;
  address_complement: string | null;
  neighborhood: string | null;
  city: string | null;
  /** UF em 2 letras maiúsculas. */
  state: string | null;
  /** Telefone principal em E.164. */
  phone_primary: string | null;
  phone_primary_is_whatsapp: boolean;
  /** Segundo telefone em E.164. */
  phone_secondary: string | null;
  phone_secondary_is_whatsapp: boolean;
  /** Gerente de contas: `user_id` do responsável pela empresa. */
  account_manager_user_id: string | null;
}

/** Contato da Base Central. */
export interface Contact extends CompanyFields {
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
  /** Nome do gerente de contas resolvido no backend. */
  account_manager_name: string | null;
}

/** Filtros da listagem de contatos. */
export interface ListContactsParams {
  type?: "pessoa" | "empresa" | undefined;
  search?: string | undefined;
  /** Filtra empresas por status de contrato. `undefined` = todas. */
  contractActive?: boolean | undefined;
  /** Filtra pela carteira de um gerente de contas. */
  accountManagerUserId?: string | undefined;
}

/** Lista contatos, filtrando por tipo, texto, status de contrato e gerente. */
export function listContacts(params: ListContactsParams = {}): Promise<ContactListItem[]> {
  const qs = new URLSearchParams();
  if (params.type) qs.set("type", params.type);
  if (params.search) qs.set("search", params.search);
  if (params.contractActive !== undefined) qs.set("contract_active", String(params.contractActive));
  if (params.accountManagerUserId) qs.set("account_manager_user_id", params.accountManagerUserId);
  const s = qs.toString();
  return request<ContactListItem[]>(`/api/contacts${s ? `?${s}` : ""}`);
}

/** Cria uma pessoa. */
export function createPerson(input: { full_name: string; email: string; phone: string }): Promise<Contact> {
  return request<Contact>("/api/contacts", { method: "POST", body: { contact_type: "pessoa", ...input } });
}

/** Cria uma empresa (razão social + CNPJ obrigatórios; demais campos opcionais). */
export function createCompany(
  input: { legal_name: string; fiscal_document: string } & Partial<CompanyFields>,
): Promise<Contact> {
  return request<Contact>("/api/contacts", { method: "POST", body: { contact_type: "empresa", ...input } });
}

/** Campos que o PATCH de contato aceita. */
export type ContactPatch = Partial<
  Pick<Contact, "full_name" | "email" | "phone" | "legal_name" | "fiscal_document"> & CompanyFields
>;

/** Atualiza um contato. */
export function updateContact(id: string, patch: ContactPatch): Promise<Contact> {
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

/**
 * Converte os dados oficiais de um CNPJ nos campos cadastrais da empresa, para
 * que os cadastros rápidos (CRM) gravem o que a consulta já trouxe em vez de
 * descartar. Só inclui o que veio preenchido e válido.
 *
 * @param data - Resposta do autofill de CNPJ.
 * @returns Campos cadastrais prontos para `createCompany`/`createAccount`.
 */
export function companyFieldsFromCnpj(data: CnpjData): Partial<CompanyFields> {
  const fields: Partial<CompanyFields> = {};
  if (data.city) fields.city = data.city;
  if (data.state) fields.state = data.state.toUpperCase().slice(0, 2);
  const digits = (data.phone ?? "").replace(/\D/g, "");
  // O telefone oficial vem como DDD + número; abaixo de 10 dígitos não forma E.164.
  if (digits.length >= 10) fields.phone_primary = `+55${digits.slice(0, 11)}`;
  return fields;
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

/** Endereço resolvido a partir de um CEP (autofill). */
export interface CepData {
  zip_code: string;
  street_address: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
}

/** Consulta o endereço de um CEP para pré-preencher o cadastro. */
export async function lookupCep(cep: string): Promise<CepData | null> {
  const digits = cep.replace(/\D/g, "");
  if (digits.length !== 8) return null;
  try {
    return await request<CepData>(`/api/contacts/cep/${digits}`);
  } catch {
    return null;
  }
}

// --- Contatos vinculados a uma empresa ---

/** Papéis canônicos de uma pessoa na empresa. */
export const COMPANY_PERSON_ROLES = ["principal", "tecnico", "portabilidade", "extra"] as const;

/** Um papel canônico de pessoa na empresa. */
export type CompanyPersonRole = (typeof COMPANY_PERSON_ROLES)[number];

/** Rótulos legíveis dos papéis, para exibição na interface. */
export const COMPANY_PERSON_ROLE_LABELS: Record<CompanyPersonRole, string> = {
  principal: "Responsável principal",
  tecnico: "Técnico",
  portabilidade: "Portabilidade",
  extra: "Contato extra",
};

/** Pessoa vinculada a uma empresa, com os dados resolvidos do núcleo. */
export interface CompanyPerson {
  person_id: string;
  role: string | null;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  created_at: string;
}

/** Lista as pessoas vinculadas a uma empresa, com seus papéis. */
export function listCompanyPeople(companyId: string): Promise<CompanyPerson[]> {
  return request<CompanyPerson[]>(`/api/contacts/${companyId}/people`);
}

/** Vincula uma pessoa à empresa com um papel. */
export function linkCompanyPerson(companyId: string, personId: string, role?: CompanyPersonRole): Promise<void> {
  return request<void>(`/api/contacts/${companyId}/people`, {
    method: "POST",
    body: { person_id: personId, ...(role ? { role } : {}) },
  });
}

/** Altera o papel de uma pessoa já vinculada à empresa. */
export function setCompanyPersonRole(
  companyId: string,
  personId: string,
  role: CompanyPersonRole | null,
): Promise<void> {
  return request<void>(`/api/contacts/${companyId}/people/${personId}`, { method: "PATCH", body: { role } });
}

/** Desvincula uma pessoa da empresa. */
export function unlinkCompanyPerson(companyId: string, personId: string): Promise<void> {
  return request<void>(`/api/contacts/${companyId}/people/${personId}`, { method: "DELETE" });
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
