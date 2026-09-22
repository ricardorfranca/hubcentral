/**
 * @file PhoneField.test.tsx
 *
 * Regressão do campo de telefone: ele precisa aceitar digitação dígito a
 * dígito. O `onChange` só emite E.164 quando o número está completo, então o
 * componente mantém os dígitos parciais em estado próprio — sem isso, o campo
 * ficava permanentemente vazio e qualquer cadastro com telefone obrigatório
 * falhava ("telefone não preenchido").
 */

import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PhoneField, toNationalDigits, toE164Br } from "./PhoneField.js";

/** Hospedeiro controlado, igual ao uso real (estado no pai). */
function Host({ initial = "", onValue }: { initial?: string; onValue?: (v: string) => void }): JSX.Element {
  const [phone, setPhone] = useState(initial);
  return (
    <>
      <PhoneField
        value={phone}
        onChange={(v) => { setPhone(v); onValue?.(v); }}
      />
      <output data-testid="emitido">{phone}</output>
    </>
  );
}

describe("PhoneField", () => {
  it("aceita digitação parcial e mantém os dígitos no campo", async () => {
    const user = userEvent.setup();
    render(<Host />);
    const input = screen.getByLabelText(/telefone/i);

    await user.type(input, "11");
    expect(input).toHaveValue("(11");

    // Até 10 dígitos a máscara é a de fixo: (DD) NNNN-NNNN.
    await user.type(input, "98765");
    expect(input).toHaveValue("(11) 9876-5");

    // Ainda incompleto: nada foi emitido ao pai, mas o digitado permanece.
    expect(screen.getByTestId("emitido")).toHaveTextContent("");
  });

  it("emite E.164 quando o número fica completo", async () => {
    const user = userEvent.setup();
    const onValue = vi.fn();
    render(<Host onValue={onValue} />);
    const input = screen.getByLabelText(/telefone/i);

    await user.type(input, "11987654321");
    expect(input).toHaveValue("(11) 98765-4321");
    expect(screen.getByTestId("emitido")).toHaveTextContent("+5511987654321");
    expect(onValue).toHaveBeenLastCalledWith("+5511987654321");
  });

  it("sinaliza erro enquanto o número está incompleto e limpa ao completar", async () => {
    const user = userEvent.setup();
    render(<Host />);
    const input = screen.getByLabelText(/telefone/i);

    await user.type(input, "1198");
    expect(screen.getByText(/DDD \+ número/i)).toBeInTheDocument();

    await user.type(input, "7654321");
    expect(screen.queryByText(/DDD \+ número/i)).not.toBeInTheDocument();
  });

  it("apagar até ficar incompleto não zera o que já foi digitado", async () => {
    const user = userEvent.setup();
    render(<Host />);
    const input = screen.getByLabelText(/telefone/i);

    await user.type(input, "11987654321");
    // Apaga dois caracteres: cai abaixo do mínimo e o pai recebe "".
    await user.type(input, "{backspace}{backspace}");
    expect(input).toHaveValue("(11) 9876-543");
    expect(screen.getByTestId("emitido")).toHaveTextContent("");
  });

  it("exibe um valor já cadastrado vindo do pai", () => {
    render(<Host initial="+5511987654321" />);
    expect(screen.getByLabelText(/telefone/i)).toHaveValue("(11) 98765-4321");
  });

  it("toNationalDigits e toE164Br continuam consistentes", () => {
    expect(toNationalDigits("+5511987654321")).toBe("11987654321");
    expect(toNationalDigits("(11) 98765-4321")).toBe("11987654321");
    expect(toE164Br("11987654321")).toBe("+5511987654321");
    expect(toE164Br("119876")).toBe("");
  });
});
