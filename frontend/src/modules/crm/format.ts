/**
 * @file format.ts
 * @module modules/crm
 *
 * Helpers de formatação usados nas telas do CRM 2.0 (moeda BRL, número inteiro).
 */

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/**
 * Formata um valor numérico (ou string numérica) como moeda BRL.
 *
 * @param value - Valor em reais; strings são convertidas.
 * @returns Texto formatado, ex.: `R$ 1.234,56`.
 */
export function brl(value: number | string | null | undefined): string {
  const n = typeof value === "string" ? Number(value) : value ?? 0;
  return BRL.format(Number.isFinite(n) ? (n as number) : 0);
}

/**
 * Formata uma data ISO como data/hora local pt-BR.
 *
 * @param iso - Data ISO ou `null`.
 * @returns Texto formatado ou `—`.
 */
export function dateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR");
}

/**
 * Rótulos amigáveis de origem de oportunidade.
 */
export const ORIGIN_LABELS: Record<string, string> = {
  inbound: "Inbound",
  outbound: "Outbound",
  indicacao: "Indicação",
};

/**
 * Rótulos amigáveis de qualificação.
 */
export const QUALIFICATION_LABELS: Record<string, string> = {
  frio: "Frio",
  morno: "Morno",
  quente: "Quente",
};

/**
 * Rótulos amigáveis de tipo de atividade.
 */
export const ACTIVITY_LABELS: Record<string, string> = {
  ligacao: "Ligação",
  email: "E-mail",
  reuniao: "Reunião",
  tarefa: "Tarefa",
  nota: "Nota",
};
