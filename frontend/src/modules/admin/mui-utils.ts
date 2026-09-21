/**
 * @file mui-utils.ts
 * @module modules/admin
 *
 * Utilitários de interoperabilidade com o MUI sob `exactOptionalPropertyTypes`.
 */

import type { TextFieldProps, AutocompleteRenderInputParams } from "@mui/material";

/**
 * Adapta os `params` do `Autocomplete.renderInput` para props de `TextField`
 * sob `exactOptionalPropertyTypes`. O MUI emite props opcionais como
 * `prop: T | undefined` (inclusive aninhadas em `InputLabelProps`), o que o
 * compilador rejeita ao repassar explicitamente para o `TextField`.
 *
 * A adaptação é APENAS no nível de tipos: devolvemos o mesmo objeto, sem cópia.
 * Transformar os `params` em runtime quebra o componente, porque eles carregam
 * refs e elementos React (`InputProps.ref`, `endAdornment`) cujo `_owner` aponta
 * para a árvore de fibers do React — uma estrutura cíclica. Percorrê-la
 * recursivamente causa `RangeError: Maximum call stack size exceeded`, o
 * componente lança e a página inteira fica branca. Ver o teste de regressão em
 * `mui-utils.test.tsx`.
 *
 * @param params - Params fornecidos pelo `renderInput`.
 * @returns Os mesmos params, tipados para espalhar em um `TextField`.
 */
export function textFieldParams(params: AutocompleteRenderInputParams): TextFieldProps {
  return params as unknown as TextFieldProps;
}
