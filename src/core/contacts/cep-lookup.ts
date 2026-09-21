/**
 * @file cep-lookup.ts
 * @module core/contacts
 *
 * Consulta de endereço por CEP para pré-preenchimento do cadastro de empresa
 * (Req 1.4). Usa a BrasilAPI (pública, sem chave), que já agrega ViaCEP,
 * Correios e outros provedores — o mesmo provedor do autofill de CNPJ, para
 * manter uma única dependência externa.
 *
 * Degrada com elegância: se a rede/serviço estiver indisponível, retorna
 * `null` em vez de falhar o cadastro.
 */

/** Endereço público resolvido a partir de um CEP. */
export interface CepData {
  /** CEP normalizado (8 dígitos). */
  zip_code: string;
  /** Logradouro (rua/avenida). */
  street_address: string | null;
  /** Bairro. */
  neighborhood: string | null;
  /** Cidade. */
  city: string | null;
  /** UF (2 letras). */
  state: string | null;
}

/** Normaliza um CEP para 8 dígitos. */
export function normalizeCep(cep: string): string {
  return cep.replace(/\D/g, "").slice(0, 8);
}

/**
 * Busca o endereço de um CEP na BrasilAPI. Retorna `null` se o CEP for
 * inválido, não for encontrado, ou o serviço estiver indisponível (sem lançar).
 *
 * @param cep - CEP (com ou sem máscara).
 * @returns O endereço, ou `null`.
 */
export async function lookupCep(cep: string): Promise<CepData | null> {
  const digits = normalizeCep(cep);
  if (digits.length !== 8) return null;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(`https://brasilapi.com.br/api/cep/v2/${digits}`, {
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
    const uf = str("state");
    return {
      zip_code: digits,
      street_address: str("street"),
      neighborhood: str("neighborhood"),
      city: str("city"),
      state: uf ? uf.toUpperCase().slice(0, 2) : null,
    };
  } catch {
    // Rede/serviço indisponível: degrada sem quebrar o cadastro.
    return null;
  }
}
