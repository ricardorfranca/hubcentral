import fc from "fast-check";
import type { CompanyContactInput, PersonContactInput } from "../../src/core/contacts/types.js";

/**
 * @file arbitraries.ts
 *
 * Geradores fast-check reutilizáveis para os testes de propriedade da Base
 * Central de Contatos.
 */

/** Gera um segmento local/label de e-mail sem espaços nem '@'. */
const emailAtom = fc
  .string({ minLength: 1, maxLength: 12 })
  .map((s) => s.replace(/[\s@.]/g, "x"))
  .filter((s) => s.length >= 1);

/**
 * Gera um e-mail VÁLIDO segundo o EMAIL_PATTERN (local@dominio.tld, tld>=2).
 */
export const validEmailArb: fc.Arbitrary<string> = fc
  .tuple(emailAtom, emailAtom, fc.string({ minLength: 2, maxLength: 4 }).map((s) => s.replace(/[\s@.]/g, "x")))
  .filter(([, , tld]) => tld.length >= 2)
  .map(([local, domain, tld]) => `${local}@${domain}.${tld}`);

/**
 * Gera uma string que NÃO é um e-mail válido (sem '@' ou malformada).
 * Filtra explicitamente qualquer coincidência com o padrão válido.
 */
export const invalidEmailArb: fc.Arbitrary<string> = fc
  .oneof(
    fc.string({ maxLength: 20 }).filter((s) => !s.includes("@")),
    fc.constant("sem-arroba.com"),
    fc.constant("@dominio.com"),
    fc.constant("local@"),
    fc.constant("local@dominio"),
    fc.constant("local@dominio.x"),
    fc.constant("a b@dominio.com"),
  )
  // Exclui coincidências com o padrão válido E strings em branco: uma string
  // vazia/só-espaços é tratada como CAMPO AUSENTE (Req 1.6 / Property 2), não
  // como e-mail mal formatado (Property 3). Mantém as propriedades disjuntas.
  .filter((s) => s.trim() !== "" && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s));

/** Gera um telefone não vazio simples. */
const phoneArb = fc
  .string({ minLength: 8, maxLength: 15 })
  .map((s) => s.replace(/\D/g, "9"))
  .filter((s) => s.length >= 8);

/** Gera um nome não vazio (sem ser só espaços). */
const nonEmptyNameArb = fc
  .string({ minLength: 1, maxLength: 100 })
  .filter((s) => s.trim().length > 0);

/** Gera um documento fiscal não vazio. */
const fiscalDocArb = fc
  .string({ minLength: 4, maxLength: 20 })
  .map((s) => s.replace(/[\s@]/g, "0"))
  .filter((s) => s.trim().length >= 4);

/**
 * Gera uma entrada VÁLIDA de contato pessoa (todos os obrigatórios preenchidos
 * e e-mail válido).
 */
export const personInputArb: fc.Arbitrary<PersonContactInput> = fc.record({
  contact_type: fc.constant("pessoa" as const),
  full_name: nonEmptyNameArb,
  email: validEmailArb,
  phone: phoneArb,
});

/**
 * Gera uma entrada VÁLIDA de contato empresa.
 */
export const companyInputArb: fc.Arbitrary<CompanyContactInput> = fc.record({
  contact_type: fc.constant("empresa" as const),
  legal_name: nonEmptyNameArb,
  fiscal_document: fiscalDocArb,
});
