/**
 * @file CompanyDialog.tsx
 * @module modules/contacts
 *
 * Cadastro de EMPRESA na Base Central de Contatos: criação e edição dos dados
 * cadastrais oficiais (status do contrato, endereço com autofill por CEP,
 * inscrição estadual, site, dois telefones com marcação de WhatsApp e gerente
 * de contas) além da gestão dos contatos vinculados por papel (responsável
 * principal, técnico, portabilidade e contato extra).
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Box, Stack, Typography, TextField, MenuItem, Button, Switch, FormControlLabel, Divider,
  Dialog, DialogTitle, DialogContent, DialogActions, Alert, Chip, IconButton, Tooltip,
  Tabs, Tab, CircularProgress, Grid2 as Grid,
} from "@mui/material";
import DeleteIcon from "@mui/icons-material/Delete";
import WhatsAppIcon from "@mui/icons-material/WhatsApp";
import {
  createCompany, updateContact, lookupCnpj, lookupCep, listContacts, companyFieldsFromCnpj,
  listCompanyPeople, linkCompanyPerson, setCompanyPersonRole, unlinkCompanyPerson,
  COMPANY_PERSON_ROLES, COMPANY_PERSON_ROLE_LABELS,
  type Contact, type CompanyPersonRole, type ContactPatch,
} from "../../core/api/contacts.js";
import { listUserOptions } from "../../core/api/iam.js";
import { PhoneField } from "../../core/ui/PhoneField.js";
import { ApiError } from "../../core/api/client.js";
import { CustomFieldsEditor, type FieldFeedback } from "./CustomFieldsEditor.js";

/**
 * Estado do formulário de empresa. Mantém tudo como string/boolean (o que os
 * campos do MUI produzem); a conversão para `null` acontece no envio.
 */
export interface CompanyForm {
  legal_name: string;
  fiscal_document: string;
  contract_active: boolean;
  state_tax_id: string;
  website: string;
  zip_code: string;
  street_address: string;
  address_number: string;
  address_complement: string;
  neighborhood: string;
  city: string;
  state: string;
  phone_primary: string;
  phone_primary_is_whatsapp: boolean;
  phone_secondary: string;
  phone_secondary_is_whatsapp: boolean;
  account_manager_user_id: string;
}

/** Formulário vazio, para o fluxo de criação. */
function emptyCompanyForm(): CompanyForm {
  return {
    legal_name: "",
    fiscal_document: "",
    contract_active: false,
    state_tax_id: "",
    website: "",
    zip_code: "",
    street_address: "",
    address_number: "",
    address_complement: "",
    neighborhood: "",
    city: "",
    state: "",
    phone_primary: "",
    phone_primary_is_whatsapp: false,
    phone_secondary: "",
    phone_secondary_is_whatsapp: false,
    account_manager_user_id: "",
  };
}

/**
 * Converte uma empresa já persistida no estado do formulário.
 *
 * @param c - Empresa vinda da API.
 * @returns O estado inicial do formulário de edição.
 */
function companyFormFrom(c: Contact): CompanyForm {
  return {
    legal_name: c.legal_name ?? "",
    fiscal_document: c.fiscal_document ?? "",
    contract_active: c.contract_active,
    state_tax_id: c.state_tax_id ?? "",
    website: c.website ?? "",
    zip_code: c.zip_code ?? "",
    street_address: c.street_address ?? "",
    address_number: c.address_number ?? "",
    address_complement: c.address_complement ?? "",
    neighborhood: c.neighborhood ?? "",
    city: c.city ?? "",
    state: c.state ?? "",
    phone_primary: c.phone_primary ?? "",
    phone_primary_is_whatsapp: c.phone_primary_is_whatsapp,
    phone_secondary: c.phone_secondary ?? "",
    phone_secondary_is_whatsapp: c.phone_secondary_is_whatsapp,
    account_manager_user_id: c.account_manager_user_id ?? "",
  };
}

/** Texto vazio vira `null` (o backend interpreta `null` como "campo limpo"). */
function orNull(value: string): string | null {
  const t = value.trim();
  return t === "" ? null : t;
}

/**
 * Monta o corpo a enviar à API a partir do formulário. Só o CNPJ é normalizado
 * aqui (para dígitos); CEP, UF e site são normalizados também no backend.
 *
 * @param form - Estado do formulário.
 * @returns Corpo pronto para `createCompany`/`updateContact`.
 */
function companyPayload(form: CompanyForm): ContactPatch & { legal_name: string; fiscal_document: string } {
  return {
    legal_name: form.legal_name.trim(),
    fiscal_document: form.fiscal_document.replace(/\D/g, ""),
    contract_active: form.contract_active,
    state_tax_id: orNull(form.state_tax_id),
    website: orNull(form.website),
    zip_code: orNull(form.zip_code.replace(/\D/g, "")),
    street_address: orNull(form.street_address),
    address_number: orNull(form.address_number),
    address_complement: orNull(form.address_complement),
    neighborhood: orNull(form.neighborhood),
    city: orNull(form.city),
    state: orNull(form.state),
    phone_primary: orNull(form.phone_primary),
    phone_primary_is_whatsapp: form.phone_primary_is_whatsapp,
    phone_secondary: orNull(form.phone_secondary),
    phone_secondary_is_whatsapp: form.phone_secondary_is_whatsapp,
    account_manager_user_id: orNull(form.account_manager_user_id),
  };
}

/** Formata um CEP para exibição (`00000-000`). */
function formatCep(value: string): string {
  const d = value.replace(/\D/g, "").slice(0, 8);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
}

/**
 * Campos do cadastro de empresa. Componente controlado: recebe o estado e o
 * setter, para poder ser reaproveitado pelos diálogos de criação e de edição.
 *
 * @param props - `form` atual, `onChange` parcial e se o CNPJ é editável.
 * @returns Os campos do formulário.
 */
export function CompanyFormFields({
  form, onChange, cnpjEditable = true,
}: {
  form: CompanyForm;
  onChange: (patch: Partial<CompanyForm>) => void;
  cnpjEditable?: boolean;
}): JSX.Element {
  const [lookingUpCnpj, setLookingUpCnpj] = useState(false);
  const [lookingUpCep, setLookingUpCep] = useState(false);
  const { data: users } = useQuery({ queryKey: ["users", "options"], queryFn: listUserOptions });

  /** Busca os dados oficiais do CNPJ e preenche o que ainda está vazio. */
  async function onCnpjBlur(): Promise<void> {
    if (form.fiscal_document.replace(/\D/g, "").length !== 14) return;
    setLookingUpCnpj(true);
    const data = await lookupCnpj(form.fiscal_document);
    setLookingUpCnpj(false);
    if (!data) return;
    // Reusa a mesma conversão do CRM, para não divergirem.
    const official = companyFieldsFromCnpj(data);
    const patch: Partial<CompanyForm> = {};
    if (data.legal_name && !form.legal_name) patch.legal_name = data.legal_name;
    if (official.city && !form.city) patch.city = official.city;
    if (official.state && !form.state) patch.state = official.state;
    if (official.phone_primary && !form.phone_primary) patch.phone_primary = official.phone_primary;
    onChange(patch);
  }

  /** Busca o endereço do CEP e substitui logradouro, bairro, cidade e UF. */
  async function onCepBlur(): Promise<void> {
    if (form.zip_code.replace(/\D/g, "").length !== 8) return;
    setLookingUpCep(true);
    const data = await lookupCep(form.zip_code);
    setLookingUpCep(false);
    if (!data) return;
    // Estes quatro campos são derivados do CEP: sobrescrevemos e deixamos
    // editáveis. Número e complemento nunca vêm do CEP.
    onChange({
      street_address: data.street_address ?? form.street_address,
      neighborhood: data.neighborhood ?? form.neighborhood,
      city: data.city ?? form.city,
      state: data.state ?? form.state,
    });
  }

  return (
    <Stack spacing={2.5} sx={{ mt: 1 }}>
      {/* Status do cliente */}
      <FormControlLabel
        control={
          <Switch
            checked={form.contract_active}
            onChange={(e) => onChange({ contract_active: e.target.checked })}
          />
        }
        label={
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography variant="body2">Contrato ativo</Typography>
            <Chip
              size="small"
              color={form.contract_active ? "success" : "default"}
              label={form.contract_active ? "Cliente ativo" : "Sem contrato ativo"}
            />
          </Stack>
        }
      />

      <Divider textAlign="left"><Typography variant="caption">Dados oficiais</Typography></Divider>

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            label="CNPJ"
            value={form.fiscal_document}
            onChange={(e) => onChange({ fiscal_document: e.target.value })}
            onBlur={() => void onCnpjBlur()}
            placeholder="00.000.000/0000-00"
            helperText={lookingUpCnpj ? "Consultando dados oficiais…" : "Ao sair do campo, buscamos os dados oficiais (editáveis)."}
            disabled={!cnpjEditable}
            required
            fullWidth
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            label="Razão social"
            value={form.legal_name}
            onChange={(e) => onChange({ legal_name: e.target.value })}
            required
            fullWidth
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            label="Inscrição estadual"
            value={form.state_tax_id}
            onChange={(e) => onChange({ state_tax_id: e.target.value })}
            placeholder="ISENTO, se for o caso"
            fullWidth
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            label="Website"
            value={form.website}
            onChange={(e) => onChange({ website: e.target.value })}
            placeholder="empresa.com.br"
            fullWidth
          />
        </Grid>
      </Grid>

      <Divider textAlign="left"><Typography variant="caption">Endereço</Typography></Divider>

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, sm: 4 }}>
          <TextField
            label="CEP"
            value={formatCep(form.zip_code)}
            onChange={(e) => onChange({ zip_code: e.target.value.replace(/\D/g, "").slice(0, 8) })}
            onBlur={() => void onCepBlur()}
            placeholder="00000-000"
            helperText={lookingUpCep ? "Buscando endereço…" : "Preenche endereço, bairro, cidade e UF."}
            fullWidth
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 8 }}>
          <TextField
            label="Endereço"
            value={form.street_address}
            onChange={(e) => onChange({ street_address: e.target.value })}
            fullWidth
          />
        </Grid>
        <Grid size={{ xs: 6, sm: 3 }}>
          <TextField
            label="Número"
            value={form.address_number}
            onChange={(e) => onChange({ address_number: e.target.value })}
            fullWidth
          />
        </Grid>
        <Grid size={{ xs: 6, sm: 5 }}>
          <TextField
            label="Complemento"
            value={form.address_complement}
            onChange={(e) => onChange({ address_complement: e.target.value })}
            placeholder="Sala, andar, bloco"
            fullWidth
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <TextField
            label="Bairro"
            value={form.neighborhood}
            onChange={(e) => onChange({ neighborhood: e.target.value })}
            fullWidth
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 9 }}>
          <TextField
            label="Cidade"
            value={form.city}
            onChange={(e) => onChange({ city: e.target.value })}
            fullWidth
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 3 }}>
          <TextField
            label="UF"
            value={form.state}
            onChange={(e) => onChange({ state: e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 2) })}
            placeholder="SP"
            inputProps={{ maxLength: 2 }}
            fullWidth
          />
        </Grid>
      </Grid>

      <Divider textAlign="left"><Typography variant="caption">Telefones principais</Typography></Divider>

      <Grid container spacing={2} alignItems="center">
        <Grid size={{ xs: 12, sm: 7 }}>
          <PhoneField
            label="Telefone 1"
            value={form.phone_primary}
            onChange={(e164) => onChange({ phone_primary: e164 })}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 5 }}>
          <FormControlLabel
            control={
              <Switch
                color="success"
                checked={form.phone_primary_is_whatsapp}
                onChange={(e) => onChange({ phone_primary_is_whatsapp: e.target.checked })}
              />
            }
            label={<Stack direction="row" spacing={0.5} alignItems="center"><WhatsAppIcon fontSize="small" /><Typography variant="body2">É WhatsApp</Typography></Stack>}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 7 }}>
          <PhoneField
            label="Telefone 2"
            value={form.phone_secondary}
            onChange={(e164) => onChange({ phone_secondary: e164 })}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 5 }}>
          <FormControlLabel
            control={
              <Switch
                color="success"
                checked={form.phone_secondary_is_whatsapp}
                onChange={(e) => onChange({ phone_secondary_is_whatsapp: e.target.checked })}
              />
            }
            label={<Stack direction="row" spacing={0.5} alignItems="center"><WhatsAppIcon fontSize="small" /><Typography variant="body2">É WhatsApp</Typography></Stack>}
          />
        </Grid>
      </Grid>

      <Divider textAlign="left"><Typography variant="caption">Responsável interno</Typography></Divider>

      <TextField
        select
        label="Gerente de contas"
        value={form.account_manager_user_id}
        onChange={(e) => onChange({ account_manager_user_id: e.target.value })}
        helperText="Usuário do sistema responsável por esta empresa."
        fullWidth
      >
        <MenuItem value="">Sem gerente definido</MenuItem>
        {(users ?? []).map((u) => (
          <MenuItem key={u.id} value={u.id}>{u.full_name} ({u.email})</MenuItem>
        ))}
      </TextField>
    </Stack>
  );
}

/**
 * Diálogo de criação de empresa, com todos os dados cadastrais.
 *
 * @param props - Controle de abertura e callback de conclusão.
 * @returns O diálogo de nova empresa.
 */
export function NewCompanyDialog({
  open, onClose, onDone,
}: {
  open: boolean; onClose: () => void; onDone: () => void;
}): JSX.Element {
  const [form, setForm] = useState<CompanyForm>(emptyCompanyForm);
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => createCompany(companyPayload(form)),
    onSuccess: () => { onDone(); onClose(); setForm(emptyCompanyForm()); },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Falha ao criar empresa."),
  });

  const canSave = form.legal_name.trim() !== "" && form.fiscal_document.replace(/\D/g, "").length === 14;

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>Nova empresa</DialogTitle>
      <DialogContent dividers>
        {error && <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 1 }}>{error}</Alert>}
        <CompanyFormFields form={form} onChange={(patch) => setForm((f) => ({ ...f, ...patch }))} />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancelar</Button>
        <Button variant="contained" onClick={() => create.mutate()} disabled={create.isPending || !canSave}>
          Criar
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/**
 * Diálogo de empresa já cadastrada: edição dos dados cadastrais, gestão dos
 * contatos vinculados por papel e campos personalizados.
 *
 * @param props - A empresa, callbacks de fechamento e de atualização da lista.
 * @returns O diálogo de detalhes da empresa.
 */
export function CompanyDetailDialog({
  company, onClose, onSaved,
}: {
  company: Contact; onClose: () => void; onSaved: () => void;
}): JSX.Element {
  const [tab, setTab] = useState<"dados" | "contatos" | "personalizados">("dados");
  const [form, setForm] = useState<CompanyForm>(() => companyFormFrom(company));
  const [feedback, setFeedback] = useState<FieldFeedback | null>(null);

  const save = useMutation({
    mutationFn: () => updateContact(company.id, companyPayload(form)),
    onSuccess: () => { onSaved(); setFeedback({ ok: true, text: "Dados cadastrais salvos." }); },
    onError: (e) => setFeedback({ ok: false, text: e instanceof ApiError ? e.message : "Falha ao salvar." }),
  });

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>
        <Stack direction="row" spacing={1} alignItems="center">
          <span>{company.legal_name || "Empresa"}</span>
          <Chip
            size="small"
            color={form.contract_active ? "success" : "default"}
            label={form.contract_active ? "Contrato ativo" : "Sem contrato ativo"}
          />
        </Stack>
      </DialogTitle>
      <DialogContent dividers>
        {feedback && (
          <Alert severity={feedback.ok ? "success" : "error"} onClose={() => setFeedback(null)} sx={{ mb: 1 }}>
            {feedback.text}
          </Alert>
        )}
        <Tabs value={tab} onChange={(_e, v) => setTab(v)} sx={{ mb: 1 }}>
          <Tab label="Dados cadastrais" value="dados" />
          <Tab label="Contatos vinculados" value="contatos" />
          <Tab label="Campos personalizados" value="personalizados" />
        </Tabs>

        {tab === "dados" && (
          <CompanyFormFields form={form} onChange={(patch) => setForm((f) => ({ ...f, ...patch }))} />
        )}
        {tab === "contatos" && (
          <CompanyPeopleEditor companyId={company.id} onFeedback={setFeedback} />
        )}
        {tab === "personalizados" && (
          <Box sx={{ mt: 2 }}>
            <CustomFieldsEditor contactId={company.id} onFeedback={setFeedback} />
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Fechar</Button>
        {tab === "dados" && (
          <Button variant="contained" onClick={() => save.mutate()} disabled={save.isPending}>
            Salvar
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}

/**
 * Gestão das pessoas vinculadas a uma empresa e de seus papéis (responsável
 * principal, técnico, portabilidade e contato extra). Os papéis são gravados em
 * `core.contact_company_links`, sem duplicar dados de contato.
 *
 * @param props - `companyId` e callback de feedback.
 * @returns O editor de contatos vinculados.
 */
function CompanyPeopleEditor({
  companyId, onFeedback,
}: {
  companyId: string; onFeedback: (f: FieldFeedback) => void;
}): JSX.Element {
  const qc = useQueryClient();
  const [personId, setPersonId] = useState<string>("");
  const [role, setRole] = useState<CompanyPersonRole>("principal");

  const { data: people, isLoading } = useQuery({
    queryKey: ["contacts", companyId, "people"],
    queryFn: () => listCompanyPeople(companyId),
  });
  const { data: persons } = useQuery({
    queryKey: ["contacts", "pessoa", ""],
    queryFn: () => listContacts({ type: "pessoa" }),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["contacts", companyId, "people"] });
  const fail = (e: unknown, fallback: string) =>
    onFeedback({ ok: false, text: e instanceof ApiError ? e.message : fallback });

  const link = useMutation({
    mutationFn: () => linkCompanyPerson(companyId, personId, role),
    onSuccess: () => { invalidate(); setPersonId(""); onFeedback({ ok: true, text: "Contato vinculado." }); },
    onError: (e) => fail(e, "Falha ao vincular o contato."),
  });
  const changeRole = useMutation({
    mutationFn: ({ pid, newRole }: { pid: string; newRole: CompanyPersonRole }) =>
      setCompanyPersonRole(companyId, pid, newRole),
    onSuccess: () => { invalidate(); onFeedback({ ok: true, text: "Papel atualizado." }); },
    onError: (e) => fail(e, "Falha ao alterar o papel."),
  });
  const unlink = useMutation({
    mutationFn: (pid: string) => unlinkCompanyPerson(companyId, pid),
    onSuccess: () => { invalidate(); onFeedback({ ok: true, text: "Contato desvinculado." }); },
    onError: (e) => fail(e, "Falha ao desvincular o contato."),
  });

  if (isLoading) return <Box sx={{ display: "grid", placeItems: "center", height: 120 }}><CircularProgress /></Box>;

  const linkedIds = new Set((people ?? []).map((p) => p.person_id));
  const available = (persons ?? []).filter((p) => !linkedIds.has(p.id));

  return (
    <Stack spacing={2} sx={{ mt: 2 }}>
      <Typography variant="caption" color="text.secondary">
        Vincule pessoas já cadastradas na Base Central. Cada empresa tem no máximo um responsável principal.
      </Typography>

      <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ sm: "center" }}>
        <TextField
          select
          size="small"
          label="Pessoa"
          value={personId}
          onChange={(e) => setPersonId(e.target.value)}
          sx={{ flex: 1, minWidth: 220 }}
        >
          <MenuItem value="">Selecione um contato…</MenuItem>
          {available.map((p) => (
            <MenuItem key={p.id} value={p.id}>
              {p.full_name ?? "—"}{p.email ? ` — ${p.email}` : ""}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          size="small"
          label="Papel"
          value={role}
          onChange={(e) => setRole(e.target.value as CompanyPersonRole)}
          sx={{ minWidth: 200 }}
        >
          {COMPANY_PERSON_ROLES.map((r) => (
            <MenuItem key={r} value={r}>{COMPANY_PERSON_ROLE_LABELS[r]}</MenuItem>
          ))}
        </TextField>
        <Button
          variant="outlined"
          onClick={() => link.mutate()}
          disabled={!personId || link.isPending}
        >
          Vincular
        </Button>
      </Stack>

      <Divider />

      {(people ?? []).length === 0 ? (
        <Typography variant="body2" color="text.secondary">Nenhum contato vinculado a esta empresa.</Typography>
      ) : (
        <Stack spacing={1}>
          {(people ?? []).map((p) => (
            <Stack key={p.person_id} direction="row" spacing={1} alignItems="center">
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" noWrap>{p.full_name ?? "—"}</Typography>
                <Typography variant="caption" color="text.secondary" noWrap>
                  {[p.email, p.phone].filter(Boolean).join(" · ") || "—"}
                </Typography>
              </Box>
              <TextField
                select
                size="small"
                label="Papel"
                sx={{ minWidth: 200 }}
                value={isKnownRole(p.role) ? p.role : ""}
                onChange={(e) => changeRole.mutate({ pid: p.person_id, newRole: e.target.value as CompanyPersonRole })}
              >
                {!isKnownRole(p.role) && <MenuItem value="">{p.role ?? "Sem papel"}</MenuItem>}
                {COMPANY_PERSON_ROLES.map((r) => (
                  <MenuItem key={r} value={r}>{COMPANY_PERSON_ROLE_LABELS[r]}</MenuItem>
                ))}
              </TextField>
              <Tooltip title="Desvincular">
                <IconButton
                  size="small"
                  aria-label={`Desvincular ${p.full_name ?? "contato"}`}
                  onClick={() => unlink.mutate(p.person_id)}
                >
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Stack>
          ))}
        </Stack>
      )}
    </Stack>
  );
}

/** Indica se o papel gravado pertence ao vocabulário canônico da interface. */
function isKnownRole(role: string | null): role is CompanyPersonRole {
  return role != null && (COMPANY_PERSON_ROLES as readonly string[]).includes(role);
}
