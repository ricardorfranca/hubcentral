/**
 * @file NewOpportunityDialog.tsx
 * @module modules/crm
 *
 * Diálogo de criação de oportunidade (Receita Previsível). Exige conta B2B e
 * nome; permite escolher o contato principal (com quem vamos nos comunicar)
 * dentre os contatos da empresa, e cadastrar rapidamente um novo contato ou uma
 * nova empresa sem sair do fluxo. Captura ainda MRR + valor único, origem e
 * qualificação.
 */

import { useEffect, useState } from "react";
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Stack, TextField,
  MenuItem, Alert, Box, Typography, Divider, CircularProgress,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import { useAccount, useAccounts, useCreateAccount, useCreateOpportunity, useLinkContact } from "./sales-hooks.js";
import { useQueryClient } from "@tanstack/react-query";
import type { Origin, Qualification } from "../../core/api/crm-sales.js";
import { createPerson, lookupCnpj } from "../../core/api/contacts.js";
import { PhoneField } from "../../core/ui/PhoneField.js";
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
  const qc = useQueryClient();
  const { data: accounts } = useAccounts();
  const create = useCreateOpportunity();
  const createAccount = useCreateAccount();

  const [selectedAccount, setSelectedAccount] = useState(accountId ?? "");
  const [name, setName] = useState("");
  const [primaryContact, setPrimaryContact] = useState("");
  const [mrr, setMrr] = useState("");
  const [oneTime, setOneTime] = useState("");
  const [origin, setOrigin] = useState<Origin | "">("");
  const [qualification, setQualification] = useState<Qualification | "">("");
  const [error, setError] = useState<string | null>(null);

  // Sub-formulários inline de cadastro rápido.
  const [showNewCompany, setShowNewCompany] = useState(false);
  const [companyName, setCompanyName] = useState("");
  const [companyCnpj, setCompanyCnpj] = useState("");
  const [lookingUpCnpj, setLookingUpCnpj] = useState(false);
  const [companyNameEdited, setCompanyNameEdited] = useState(false);

  const [showNewContact, setShowNewContact] = useState(false);
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [savingContact, setSavingContact] = useState(false);

  // Contatos da empresa selecionada (para escolher o contato principal).
  const { data: account, isLoading: loadingAccount } = useAccount(selectedAccount);
  const linkContact = useLinkContact(selectedAccount);
  const accountContacts = account?.contacts ?? [];

  // Quando a conta muda, limpa o contato escolhido (não pertence à nova conta).
  useEffect(() => {
    setPrimaryContact("");
    setShowNewContact(false);
  }, [selectedAccount]);

  // Autofill: ao completar 14 dígitos de CNPJ, busca dados oficiais e preenche a
  // razão social — desde que o usuário ainda não a tenha digitado manualmente.
  useEffect(() => {
    const digits = companyCnpj.replace(/\D/g, "");
    if (!showNewCompany || digits.length !== 14) return;
    let cancelled = false;
    setLookingUpCnpj(true);
    lookupCnpj(digits)
      .then((data) => {
        if (cancelled || !data) return;
        if (!companyNameEdited && data.legal_name) {
          setCompanyName(data.legal_name);
        }
      })
      .finally(() => {
        if (!cancelled) setLookingUpCnpj(false);
      });
    return () => { cancelled = true; };
  }, [companyCnpj, showNewCompany, companyNameEdited]);

  function reset(): void {
    setSelectedAccount(accountId ?? "");
    setName("");
    setPrimaryContact("");
    setMrr("");
    setOneTime("");
    setOrigin("");
    setQualification("");
    setError(null);
    setShowNewCompany(false);
    setCompanyName("");
    setCompanyCnpj("");
    setCompanyNameEdited(false);
    setShowNewContact(false);
    setContactName("");
    setContactEmail("");
    setContactPhone("");
  }

  function handleClose(): void {
    reset();
    onClose();
  }

  /** Cadastra rapidamente uma nova empresa (conta) e a seleciona. */
  async function submitNewCompany(): Promise<void> {
    setError(null);
    if (!companyName.trim()) {
      setError("Informe a razão social da empresa.");
      return;
    }
    if (companyCnpj.replace(/\D/g, "").length !== 14) {
      setError("Informe um CNPJ válido (14 dígitos).");
      return;
    }
    try {
      const acc = await createAccount.mutateAsync({
        legal_name: companyName.trim(),
        cnpj: companyCnpj.replace(/\D/g, ""),
      });
      setSelectedAccount(acc.id);
      setShowNewCompany(false);
      setCompanyName("");
      setCompanyCnpj("");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Falha ao cadastrar empresa.");
    }
  }

  /** Cadastra rapidamente uma pessoa, vincula à conta e a define como contato principal. */
  async function submitNewContact(): Promise<void> {
    setError(null);
    if (!selectedAccount) {
      setError("Selecione a empresa antes de cadastrar o contato.");
      return;
    }
    if (!contactName.trim()) {
      setError("Informe o nome do contato.");
      return;
    }
    if (!contactEmail.trim()) {
      setError("Informe o e-mail do contato.");
      return;
    }
    setSavingContact(true);
    try {
      const person = await createPerson({
        full_name: contactName.trim(),
        email: contactEmail.trim(),
        phone: contactPhone,
      });
      await linkContact.mutateAsync({ personContactId: person.id });
      await qc.invalidateQueries({ queryKey: ["crm2", "account", selectedAccount] });
      setPrimaryContact(person.id);
      setShowNewContact(false);
      setContactName("");
      setContactEmail("");
      setContactPhone("");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Falha ao cadastrar contato.");
    } finally {
      setSavingContact(false);
    }
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
    if (!primaryContact) {
      setError("Selecione o contato principal. Toda oportunidade precisa de uma pessoa responsável na empresa.");
      return;
    }
    try {
      await create.mutateAsync({
        account_id: selectedAccount,
        name: name.trim(),
        primary_contact_id: primaryContact,
        mrr: mrr ? Number(mrr) : undefined,
        one_time: oneTime ? Number(oneTime) : undefined,
        origin: origin || undefined,
        qualification: qualification || undefined,
      });
      handleClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Falha ao criar oportunidade.");
    }
  }

  return (
    <Dialog open={open} onClose={handleClose} fullWidth maxWidth="sm">
      <DialogTitle>Nova oportunidade</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}

          {/* --- Empresa (conta) --- */}
          <TextField
            select
            label="Conta (empresa)"
            value={selectedAccount}
            onChange={(e) => setSelectedAccount(e.target.value)}
            disabled={Boolean(accountId) || showNewCompany}
            required
          >
            <MenuItem value="">Selecione…</MenuItem>
            {(accounts ?? []).map((a) => (
              <MenuItem key={a.id} value={a.id}>
                {a.legal_name ?? a.company_contact_id}{a.cnpj ? ` — ${a.cnpj}` : ""}
              </MenuItem>
            ))}
          </TextField>

          {!accountId && !showNewCompany && (
            <Button size="small" startIcon={<AddIcon />} onClick={() => setShowNewCompany(true)} sx={{ alignSelf: "flex-start" }}>
              Cadastrar nova empresa
            </Button>
          )}

          {showNewCompany && (
            <Box sx={{ p: 2, border: "1px dashed", borderColor: "divider", borderRadius: 1 }}>
              <Typography variant="subtitle2" gutterBottom>Nova empresa</Typography>
              <Stack spacing={2}>
                <TextField
                  label="CNPJ"
                  value={companyCnpj}
                  onChange={(e) => setCompanyCnpj(e.target.value)}
                  placeholder="00.000.000/0000-00"
                  required
                  helperText="Ao completar o CNPJ, buscamos a razão social automaticamente."
                  InputProps={{
                    endAdornment: lookingUpCnpj ? <CircularProgress size={18} /> : undefined,
                  }}
                />
                <TextField
                  label="Razão social"
                  value={companyName}
                  onChange={(e) => { setCompanyName(e.target.value); setCompanyNameEdited(true); }}
                  required
                  helperText="Preenchida pelo CNPJ; você pode editar manualmente."
                />
                <Stack direction="row" spacing={1} justifyContent="flex-end">
                  <Button size="small" onClick={() => { setShowNewCompany(false); setCompanyName(""); setCompanyCnpj(""); setCompanyNameEdited(false); }}>Cancelar</Button>
                  <Button size="small" variant="contained" onClick={submitNewCompany} disabled={createAccount.isPending}>
                    Salvar empresa
                  </Button>
                </Stack>
              </Stack>
            </Box>
          )}

          <Divider />

          {/* --- Contato principal --- */}
          <TextField
            select
            label="Contato principal (comunicação)"
            value={primaryContact}
            onChange={(e) => setPrimaryContact(e.target.value)}
            disabled={!selectedAccount || showNewContact}
            required
            helperText={
              !selectedAccount
                ? "Selecione a empresa para escolher o contato."
                : accountContacts.length === 0 && !loadingAccount
                ? "Esta empresa ainda não tem contatos. Cadastre um novo abaixo."
                : "Pessoa responsável na empresa com quem vamos nos comunicar (obrigatório)."
            }
          >
            <MenuItem value="">Selecione…</MenuItem>
            {loadingAccount && (
              <MenuItem value="" disabled>
                <CircularProgress size={16} sx={{ mr: 1 }} /> Carregando…
              </MenuItem>
            )}
            {accountContacts.map((c) => (
              <MenuItem key={c.person_contact_id} value={c.person_contact_id}>
                {c.full_name ?? c.person_contact_id}{c.role ? ` — ${c.role}` : ""}
              </MenuItem>
            ))}
          </TextField>

          {selectedAccount && !showNewContact && (
            <Button size="small" startIcon={<AddIcon />} onClick={() => setShowNewContact(true)} sx={{ alignSelf: "flex-start" }}>
              Cadastrar novo contato
            </Button>
          )}

          {showNewContact && (
            <Box sx={{ p: 2, border: "1px dashed", borderColor: "divider", borderRadius: 1 }}>
              <Typography variant="subtitle2" gutterBottom>Novo contato</Typography>
              <Stack spacing={2}>
                <TextField label="Nome completo" value={contactName} onChange={(e) => setContactName(e.target.value)} required />
                <TextField label="E-mail" type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} required />
                <PhoneField value={contactPhone} onChange={setContactPhone} />
                <Stack direction="row" spacing={1} justifyContent="flex-end">
                  <Button size="small" onClick={() => { setShowNewContact(false); setContactName(""); setContactEmail(""); setContactPhone(""); }}>Cancelar</Button>
                  <Button size="small" variant="contained" onClick={submitNewContact} disabled={savingContact}>
                    Salvar e vincular
                  </Button>
                </Stack>
              </Stack>
            </Box>
          )}

          <Divider />

          {/* --- Dados da oportunidade --- */}
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
        <Button onClick={handleClose}>Cancelar</Button>
        <Button variant="contained" onClick={submit} disabled={create.isPending}>
          Criar
        </Button>
      </DialogActions>
    </Dialog>
  );
}
