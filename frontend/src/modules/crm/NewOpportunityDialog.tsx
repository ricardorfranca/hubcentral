/**
 * @file NewOpportunityDialog.tsx
 * @module modules/crm
 *
 * Diálogo de criação de oportunidade (Receita Previsível). Exige conta B2B,
 * nome, e captura MRR (recorrente) + valor único, origem e qualificação.
 */

import { useState } from "react";
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Stack, TextField,
  MenuItem, Alert,
} from "@mui/material";
import { useAccounts, useCreateOpportunity } from "./sales-hooks.js";
import type { Origin, Qualification } from "../../core/api/crm-sales.js";
import { ApiError } from "../../core/api/client.js";

/** Props do diálogo. */
interface Props {
  /** Se o diálogo está aberto. */
  open: boolean;
  /** Callback ao fechar. */
  onClose: () => void;
  /** Conta pré-selecionada (opcional). */
  accountId?: string;
}

/**
 * Diálogo para criar uma nova oportunidade.
 *
 * @param props - Estado e callbacks.
 * @returns O diálogo de criação.
 */
export function NewOpportunityDialog({ open, onClose, accountId }: Props): JSX.Element {
  const { data: accounts } = useAccounts();
  const create = useCreateOpportunity();

  const [selectedAccount, setSelectedAccount] = useState(accountId ?? "");
  const [name, setName] = useState("");
  const [mrr, setMrr] = useState("");
  const [oneTime, setOneTime] = useState("");
  const [origin, setOrigin] = useState<Origin | "">("");
  const [qualification, setQualification] = useState<Qualification | "">("");
  const [error, setError] = useState<string | null>(null);

  function reset(): void {
    setSelectedAccount(accountId ?? "");
    setName("");
    setMrr("");
    setOneTime("");
    setOrigin("");
    setQualification("");
    setError(null);
  }

  async function submit(): Promise<void> {
    setError(null);
    if (!selectedAccount) {
      setError("Selecione a conta (empresa). Toda oportunidade B2B pertence a uma conta.");
      return;
    }
    if (!name.trim()) {
      setError("Informe um nome para a oportunidade.");
      return;
    }
    try {
      await create.mutateAsync({
        account_id: selectedAccount,
        name: name.trim(),
        mrr: mrr ? Number(mrr) : undefined,
        one_time: oneTime ? Number(oneTime) : undefined,
        origin: origin || undefined,
        qualification: qualification || undefined,
      });
      reset();
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Falha ao criar oportunidade.");
    }
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Nova oportunidade</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField
            select
            label="Conta (empresa)"
            value={selectedAccount}
            onChange={(e) => setSelectedAccount(e.target.value)}
            disabled={Boolean(accountId)}
            required
          >
            <MenuItem value="">Selecione…</MenuItem>
            {(accounts ?? []).map((a) => (
              <MenuItem key={a.id} value={a.id}>
                {a.legal_name ?? a.company_contact_id}{a.cnpj ? ` — ${a.cnpj}` : ""}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label="Nome da oportunidade"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <Stack direction="row" spacing={2}>
            <TextField
              label="MRR (recorrente/mês)"
              type="number"
              value={mrr}
              onChange={(e) => setMrr(e.target.value)}
              fullWidth
              InputProps={{ startAdornment: "R$ " }}
            />
            <TextField
              label="Valor único (setup)"
              type="number"
              value={oneTime}
              onChange={(e) => setOneTime(e.target.value)}
              fullWidth
              InputProps={{ startAdornment: "R$ " }}
            />
          </Stack>
          <Stack direction="row" spacing={2}>
            <TextField
              select
              label="Origem"
              value={origin}
              onChange={(e) => setOrigin(e.target.value as Origin | "")}
              fullWidth
            >
              <MenuItem value="">—</MenuItem>
              <MenuItem value="inbound">Inbound</MenuItem>
              <MenuItem value="outbound">Outbound</MenuItem>
              <MenuItem value="indicacao">Indicação</MenuItem>
            </TextField>
            <TextField
              select
              label="Qualificação"
              value={qualification}
              onChange={(e) => setQualification(e.target.value as Qualification | "")}
              fullWidth
            >
              <MenuItem value="">—</MenuItem>
              <MenuItem value="frio">Frio</MenuItem>
              <MenuItem value="morno">Morno</MenuItem>
              <MenuItem value="quente">Quente</MenuItem>
            </TextField>
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancelar</Button>
        <Button variant="contained" onClick={submit} disabled={create.isPending}>
          Criar
        </Button>
      </DialogActions>
    </Dialog>
  );
}
