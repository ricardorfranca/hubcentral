/**
 * @file PhoneField.tsx
 * @module core/ui
 *
 * Campo de telefone padronizado para o Brasil: prefixo fixo +55 com a bandeira,
 * máscara de DDD + número e armazenamento em E.164 (ex.: +5511999998888). Deve
 * ser usado em todos os cadastros que envolvem telefone.
 */

import { useState } from "react";
import { TextField, InputAdornment, Box } from "@mui/material";

/** Bandeira do Brasil (SVG inline, sem dependência externa). */
function BrazilFlag(): JSX.Element {
  return (
    <Box component="span" sx={{ display: "inline-flex", alignItems: "center", mr: 0.5 }} aria-label="Brasil">
      <svg width="20" height="14" viewBox="0 0 20 14" role="img" aria-hidden="true">
        <rect width="20" height="14" rx="2" fill="#009c3b" />
        <path d="M10 1.6 18.4 7 10 12.4 1.6 7z" fill="#ffdf00" />
        <circle cx="10" cy="7" r="3" fill="#002776" />
      </svg>
    </Box>
  );
}

/**
 * Extrai apenas os dígitos nacionais (DDD + número) de um valor E.164/br.
 *
 * @param value - Valor em E.164 (`+55...`) ou dígitos.
 * @returns Os dígitos nacionais (sem o 55).
 */
export function toNationalDigits(value: string | null | undefined): string {
  if (!value) return "";
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("55") && digits.length > 11) digits = digits.slice(2);
  return digits.slice(0, 11);
}

/**
 * Formata dígitos nacionais como `(DD) NNNNN-NNNN`.
 *
 * @param digits - Dígitos nacionais (DDD + número).
 * @returns Texto formatado para exibição.
 */
function formatBr(digits: string): string {
  const d = digits.slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : "";
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

/**
 * Converte dígitos nacionais para E.164 brasileiro (`+55DDDNÚMERO`), ou string
 * vazia se não houver dígitos suficientes.
 *
 * @param digits - Dígitos nacionais.
 * @returns E.164, ou "".
 */
export function toE164Br(digits: string): string {
  const d = digits.replace(/\D/g, "").slice(0, 11);
  return d.length >= 10 ? `+55${d}` : "";
}

/** Props do campo de telefone. */
interface Props {
  /** Valor atual (E.164 ou dígitos). */
  value: string | null | undefined;
  /** Callback com o valor em E.164 (`+55...`) ou "" enquanto incompleto. */
  onChange: (e164: string) => void;
  /** Rótulo do campo. */
  label?: string;
  /** Se o campo é obrigatório. */
  required?: boolean;
  /** Largura total. */
  fullWidth?: boolean;
}

/** Mínimo de dígitos nacionais para formar um número válido (DDD + 8). */
const MIN_NATIONAL_DIGITS = 10;

/**
 * Campo de telefone padronizado (Brasil, +55 + bandeira).
 *
 * O componente mantém os dígitos em edição em estado próprio. Isso é
 * necessário porque {@link toE164Br} — e, portanto, o `onChange` — só produz um
 * valor quando o número está completo: se o display dependesse apenas do prop
 * `value`, os primeiros dígitos digitados voltariam vazios do pai e o campo
 * nunca aceitaria digitação.
 *
 * O estado é ressincronizado quando o `value` muda por fora da digitação (reset
 * do formulário, carregamento de um cadastro existente), comparando com o
 * último valor emitido para não confundir "o pai me resetou" com "eu emiti
 * vazio porque o número ainda está incompleto".
 *
 * @param props - Valor, callback e opções de exibição.
 * @returns O campo de telefone.
 */
export function PhoneField({ value, onChange, label = "Telefone", required = false, fullWidth = true }: Props): JSX.Element {
  const current = value ?? "";
  const [digits, setDigits] = useState(() => toNationalDigits(current));
  const [lastEmitted, setLastEmitted] = useState(current);

  if (current !== lastEmitted) {
    // Mudança vinda de fora (não é eco do que emitimos): adota o novo valor.
    setLastEmitted(current);
    setDigits(toNationalDigits(current));
  }

  const incomplete = digits.length > 0 && digits.length < MIN_NATIONAL_DIGITS;

  return (
    <TextField
      label={label}
      required={required}
      fullWidth={fullWidth}
      value={formatBr(digits)}
      onChange={(e) => {
        const next = toNationalDigits(e.target.value);
        setDigits(next);
        const e164 = toE164Br(next);
        setLastEmitted(e164);
        onChange(e164);
      }}
      error={incomplete}
      {...(incomplete ? { helperText: "Informe DDD + número (10 ou 11 dígitos)." } : {})}
      placeholder="(11) 99999-9999"
      InputProps={{
        startAdornment: (
          <InputAdornment position="start">
            <BrazilFlag />
            +55
          </InputAdornment>
        ),
      }}
    />
  );
}
