/**
 * @file cnpj-lookup.ts
 * @module core/contacts
 *
 * Consulta de dados oficiais de CNPJ para pré-preenchimento de cadastro de
 * empresa. Usa a BrasilAPI (pública, sem chave). Degrada com elegância: se a
 * rede/serviço estiver indisponível, retorna `null` em vez de falhar.
 */

/** Dados públicos de uma empresa por CNPJ. */
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

/** Normaliza um CNPJ para 14 dígitos. */
export function normalizeCnpj(cnpj: string): string {
  return cnpj.replace(/\D/g, "").slice(0, 14);
}

/**
 * Busca dados de um CNPJ na BrasilAPI. Retorna `null` se o CNPJ for inválido,
 * não for encontrado, ou o serviço estiver indisponível (sem lançar).
 *
 * @param cnpj - CNPJ (com ou sem máscara).
 * @returns Os dados da empresa, ou `null`.
 */
export async function lookupCnpj(cnpj: string): Promise<CnpjData | null> {
  const digits = normalizeCnpj(cnpj);
  if (digits.length !== 14) return null;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${digits}`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    clearTimeout(timeout);
    if (!res.ok) return null;

    const data = (await res.json()) as Record<string, unknown>;
    const str = (k: string): string | null => {
      const v = data[k];
      return typeof v === "string" && v.trim() ? v.trim() : null;
    };
    const ddd = str("ddd_telefone_1");
    return {
      cnpj: digits,
      legal_name: str("razao_social"),
      trade_name: str("nome_fantasia"),
      email: str("email"),
      phone: ddd ? ddd.replace(/\D/g, "") : null,
      city: str("municipio"),
      state: str("uf"),
      status: str("descricao_situacao_cadastral"),
    };
  } catch {
    // Rede/serviço indisponível: degrada sem quebrar o cadastro.
    return null;
  }
}
