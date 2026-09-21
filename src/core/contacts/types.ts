/**
 * @file types.ts
 * @module core/contacts
 *
 * Tipos de domínio da Base Central de Contatos (Req 1).
 */

/** Discriminador de tipo de contato (Req 1.2). */
export type ContactType = "pessoa" | "empresa";

/**
 * Entrada para criação de um Contato_Pessoa (Req 1.3).
 */
export interface PersonContactInput {
  contact_type: "pessoa";
  /** Nome e sobrenome. Obrigatório. */
  full_name: string;
  /** E-mail. Obrigatório e validado por regex (Req 1.5). */
  email: string;
  /** Telefone. Obrigatório. */
  phone: string;
}

/**
 * Dados cadastrais complementares de um Contato_Empresa (Req 1.4).
 *
 * Todos são opcionais: o mínimo para cadastrar uma empresa segue sendo razão
 * social + documento fiscal. Moram em `core.contacts` (núcleo) porque o
 * contrato de módulos proíbe copiar dado de contato para schemas `mod_*`
 * (Req 7.1, 7.2).
 */
export interface CompanyRegistrationFields {
  /** Cliente com contrato ativo (`true`) ou sem contrato ativo (`false`). */
  contract_active?: boolean;
  /** Inscrição estadual (ou "ISENTO"). */
  state_tax_id?: string | null;
  /** Site institucional. */
  website?: string | null;
  /** CEP em 8 dígitos, sem máscara. Base do autofill de endereço. */
  zip_code?: string | null;
  /** Logradouro. */
  street_address?: string | null;
  /** Número do endereço. */
  address_number?: string | null;
  /** Complemento (sala, andar, bloco). */
  address_complement?: string | null;
  /** Bairro. */
  neighborhood?: string | null;
  /** Cidade. */
  city?: string | null;
  /** UF em 2 letras maiúsculas. */
  state?: string | null;
  /** Telefone principal da empresa, em E.164. */
  phone_primary?: string | null;
  /** Indica se o telefone principal tem WhatsApp. */
  phone_primary_is_whatsapp?: boolean;
  /** Segundo telefone da empresa, em E.164. */
  phone_secondary?: string | null;
  /** Indica se o segundo telefone tem WhatsApp. */
  phone_secondary_is_whatsapp?: boolean;
  /** Gerente de contas: `user_id` do responsável pela empresa. */
  account_manager_user_id?: string | null;
}

/**
 * Entrada para criação de um Contato_Empresa (Req 1.4).
 */
export interface CompanyContactInput extends CompanyRegistrationFields {
  contact_type: "empresa";
  /** Razão social. Obrigatória. */
  legal_name: string;
  /** Documento de identificação fiscal. Obrigatório. */
  fiscal_document: string;
}

/** União discriminada das entradas de criação de contato. */
export type ContactInput = PersonContactInput | CompanyContactInput;

/**
 * Contato como persistido em `core.contacts`.
 */
export interface Contact {
  id: string;
  contact_type: ContactType;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  legal_name: string | null;
  fiscal_document: string | null;
  /** Contrato ativo (só significativo para empresa). */
  contract_active: boolean;
  state_tax_id: string | null;
  website: string | null;
  zip_code: string | null;
  street_address: string | null;
  address_number: string | null;
  address_complement: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  phone_primary: string | null;
  phone_primary_is_whatsapp: boolean;
  phone_secondary: string | null;
  phone_secondary_is_whatsapp: boolean;
  account_manager_user_id: string | null;
  merged_into: string | null;
  created_at: Date;
  updated_at: Date;
}
