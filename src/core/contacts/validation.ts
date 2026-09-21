/**
 * @file validation.ts
 * @module core/contacts
 *
 * Validações puras de contato, reutilizáveis pelo serviço e pelos testes.
 * O regex de e-mail é IDÊNTICO ao CHECK de `core.contacts` (Req 1.5) para que
 * a validação de aplicação e a de banco nunca divirjam.
 */

import type { ContactInput } from "./types.js";

/**
 * Padrão de e-mail exigido pelo Req 1.5 (RFC 5322 simplificado).
 * Espelha exatamente o CHECK `contacts_email_format` da migration.
 */
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Padrão de CEP aceito no cadastro de empresa: exatamente 8 dígitos.
 * Espelha o CHECK `contacts_zip_code_format` da migration.
 */
export const ZIP_CODE_PATTERN = /^\d{8}$/;

/**
 * Padrão de UF aceito no cadastro de empresa: 2 letras maiúsculas.
 * Espelha o CHECK `contacts_state_format` da migration.
 */
export const STATE_PATTERN = /^[A-Z]{2}$/;

/**
 * Indica se uma string é um e-mail válido segundo o {@link EMAIL_PATTERN}.
 *
 * @param email - String a validar.
 * @returns `true` se casa com o padrão; caso contrário `false`.
 */
export function isValidEmail(email: string): boolean {
  return EMAIL_PATTERN.test(email);
}

/**
 * Normaliza um CEP para apenas dígitos (máximo 8), ou `null` se vazio.
 *
 * @param zipCode - CEP com ou sem máscara.
 * @returns CEP com 8 dígitos, string de dígitos parcial, ou `null`.
 */
export function normalizeZipCode(zipCode: string | null | undefined): string | null {
  if (zipCode == null) return null;
  const digits = zipCode.replace(/\D/g, "").slice(0, 8);
  return digits === "" ? null : digits;
}

/**
 * Indica se um CEP normalizado é válido (8 dígitos).
 *
 * @param zipCode - CEP já normalizado.
 * @returns `true` se casa com {@link ZIP_CODE_PATTERN}.
 */
export function isValidZipCode(zipCode: string): boolean {
  return ZIP_CODE_PATTERN.test(zipCode);
}

/**
 * Normaliza uma UF para 2 letras maiúsculas sem acento/espaço, ou `null`.
 *
 * @param state - UF informada (ex.: `sp`, ` SP `).
 * @returns UF em maiúsculas, ou `null` se vazia.
 */
export function normalizeState(state: string | null | undefined): string | null {
  if (state == null) return null;
  const upper = state.trim().toUpperCase();
  return upper === "" ? null : upper;
}

/**
 * Indica se uma UF normalizada é válida (2 letras maiúsculas).
 *
 * @param state - UF já normalizada.
 * @returns `true` se casa com {@link STATE_PATTERN}.
 */
export function isValidState(state: string): boolean {
  return STATE_PATTERN.test(state);
}

/**
 * Normaliza um endereço de site: remove espaços e prefixa `https://` quando o
 * usuário digita apenas o domínio. Retorna `null` se vazio.
 *
 * @param website - Site informado (ex.: `empresa.com.br`).
 * @returns URL normalizada, ou `null`.
 */
export function normalizeWebsite(website: string | null | undefined): string | null {
  if (website == null) return null;
  const trimmed = website.trim();
  if (trimmed === "") return null;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/**
 * Campos obrigatórios por tipo de contato (Req 1.3, 1.4). Usado para produzir
 * mensagens de erro que identificam o campo ausente (Req 1.6).
 */
export const REQUIRED_FIELDS: Record<ContactInput["contact_type"], readonly string[]> = {
  pessoa: ["full_name", "email", "phone"],
  empresa: ["legal_name", "fiscal_document"],
};

/**
 * Retorna o primeiro campo obrigatório ausente (vazio, nulo ou só espaços)
 * para o tipo do contato, ou `null` se todos os obrigatórios estão presentes.
 *
 * @param input - Entrada de criação de contato.
 * @returns Nome do campo ausente, ou `null`.
 */
export function firstMissingRequiredField(input: ContactInput): string | null {
  const fields = REQUIRED_FIELDS[input.contact_type];
  const record = input as unknown as Record<string, unknown>;
  for (const field of fields) {
    const value = record[field];
    if (typeof value !== "string" || value.trim() === "") {
      return field;
    }
  }
  return null;
}
