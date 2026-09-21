/**
 * @file mui-utils.ts
 * @module modules/admin
 *
 * Utilitários de interoperabilidade com o MUI sob `exactOptionalPropertyTypes`.
 */

import type { TextFieldProps } from "@mui/material";
import type { AutocompleteRenderInputParams } from "@mui/material";

/** Remove recursivamente as chaves cujo valor é `undefined`. */
function stripUndefined(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripUndefined);
  if (value && typeof value === "object" && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) out[k] = stripUndefined(v);
    }
    return out;
  }
  return value;
}

/**
 * Adapta os `params` do `Autocomplete.renderInput` para props de `TextField`
 * sob `exactOptionalPropertyTypes`. O MUI emite props opcionais como
 * `prop: T | undefined` (inclusive aninhadas em `InputLabelProps`), o que o
 * compilador rejeita ao repassar explicitamente para o `TextField`. Removemos
 * as chaves `undefined` (comportamento idêntico em runtime: ausência = default)
 * e devolvemos um tipo compatível com `TextField`.
 *
 * @param params - Params fornecidos pelo `renderInput`.
 * @returns Props prontas para espalhar em um `TextField`.
 */
export function textFieldParams(params: AutocompleteRenderInputParams): TextFieldProps {
  return stripUndefined(params) as TextFieldProps;
}
