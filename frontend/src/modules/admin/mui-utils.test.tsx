/**
 * @file mui-utils.test.tsx
 *
 * Regressão: os assistentes de Importação/Exportação ficavam com a tela branca
 * porque `textFieldParams` copiava os `params` do Autocomplete em runtime. Os
 * params carregam elementos React cujo `_owner` referencia a árvore de fibers
 * (cíclica), então a cópia recursiva estourava a pilha e derrubava a página.
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Autocomplete, TextField } from "@mui/material";
import { textFieldParams } from "./mui-utils.js";

const options = [{ id: "1", name: "Cliente" }];

describe("textFieldParams", () => {
  it("preserva a identidade dos params (sem cópia em runtime)", () => {
    const params = { id: "x", InputProps: {}, inputProps: {} };
    expect(textFieldParams(params as never)).toBe(params);
  });

  it("renderiza o Autocomplete simples do Assistente de Exportação", () => {
    render(
      <Autocomplete
        size="small"
        options={options}
        getOptionLabel={(o) => o.name}
        value={null}
        onChange={() => {}}
        renderInput={(params) => <TextField {...textFieldParams(params)} label="Rótulo" />}
      />,
    );
    expect(screen.getByLabelText("Rótulo")).toBeInTheDocument();
  });

  it("renderiza o Autocomplete múltiplo do Assistente de Importação", () => {
    render(
      <Autocomplete
        multiple
        size="small"
        options={options}
        getOptionLabel={(o) => o.name}
        value={options}
        onChange={() => {}}
        renderInput={(params) => <TextField {...textFieldParams(params)} label="Rótulos" />}
      />,
    );
    expect(screen.getByLabelText("Rótulos")).toBeInTheDocument();
  });
});
