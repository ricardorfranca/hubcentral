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
 * Entrada para criação de um Contato_Empresa (Req 1.4).
 */
export interface CompanyContactInput {
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
  merged_into: string | null;
  created_at: Date;
  updated_at: Date;
}
