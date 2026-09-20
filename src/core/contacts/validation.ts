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
 * Indica se uma string é um e-mail válido segundo o {@link EMAIL_PATTERN}.
 *
 * @param email - String a validar.
 * @returns `true` se casa com o padrão; caso contrário `false`.
 */
export function isValidEmail(email: string): boolean {
  return EMAIL_PATTERN.test(email);
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
