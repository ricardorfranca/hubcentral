/**
 * @file NewLeadDialog.tsx
 * @module modules/crm
 *
 * Diálogo de criação de lead. Coleta os dados de contato da pessoa (e,
 * opcionalmente, da empresa); o backend faz find-or-create na Base Central.
 */

import { useState } from "react";
import {
  Dialog, DialogTitle, DialogContent, DialogActions, TextField, Button, Alert, Stack,
} from "@mui/material";
import { useCreateLead } from "./hooks.js";
import { ApiError } from "../../core/api/client.js";

/**
 * Diálogo para criar um novo lead.
 *
 * @param props.open - Se o diálogo está aberto.
 * @param props.onClose - Callback de fechamento.
 * @returns O diálogo de criação.
 */
export function NewLeadDialog({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element {
  const createLead = useCreateLead();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(): Promise<void> {
    setError(null);
    try {
      await createLead.mutateAsync({ person: { full_name: fullName, email, phone } });
      setFullName("");
      setEmail("");
      setPhone("");
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao criar o lead.");
    }
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Novo lead</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField label="Nome e sobrenome" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
          <TextField label="E-mail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <TextField label="Telefone" value={phone} onChange={(e) => setPhone(e.target.value)} required />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancelar</Button>
        <Button variant="contained" onClick={onSubmit} disabled={createLead.isPending}>
          {createLead.isPending ? "Criando..." : "Criar"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
