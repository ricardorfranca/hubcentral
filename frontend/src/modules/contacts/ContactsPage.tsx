/**
 * @file ContactsPage.tsx
 * @module modules/contacts
 *
 * Gestão da Base Central de Contatos: lista pessoas e empresas (leads ou não),
 * com busca, rótulos (labels) e criação. É a fundação de contatos reutilizada
 * por CRM, Projetos e campanhas.
 *
 * O cadastro de empresa (dados oficiais, endereço, telefones, gerente de contas
 * e contatos vinculados por papel) vive em {@link ./CompanyDialog}.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Box, Typography, Stack, Button, Tabs, Tab, TextField, Table, TableBody, TableCell, TableHead,
  TableRow, Paper, TableContainer, CircularProgress, Dialog, DialogTitle, DialogContent, DialogActions,
  Chip, MenuItem, Alert, IconButton, Tooltip, Divider,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import TuneIcon from "@mui/icons-material/Tune";
import WhatsAppIcon from "@mui/icons-material/WhatsApp";
import CallIcon from "@mui/icons-material/Call";
import SmsIcon from "@mui/icons-material/Sms";
import {
  listContacts, createPerson, listLabels, createLabel, assignLabel, unassignLabel,
  type ContactListItem,
} from "../../core/api/contacts.js";
import { sendWhatsapp, sendSms, requestCall } from "../../core/api/comms.js";
import { PhoneField } from "../../core/ui/PhoneField.js";
import { ApiError } from "../../core/api/client.js";
import { CustomFieldsEditor, type FieldFeedback } from "./CustomFieldsEditor.js";
import { NewCompanyDialog, CompanyDetailDialog } from "./CompanyDialog.js";

/** Opções do filtro de status de contrato da aba Empresas. */
type ContractFilter = "todos" | "ativos" | "inativos";

/**
 * Página de gestão de contatos.
 *
 * @returns A tela de contatos.
 */
export function ContactsPage(): JSX.Element {
  const qc = useQueryClient();
  const [tab, setTab] = useState<"pessoa" | "empresa">("pessoa");
  const [search, setSearch] = useState("");
  const [contractFilter, setContractFilter] = useState<ContractFilter>("todos");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [detailContact, setDetailContact] = useState<ContactListItem | null>(null);

  // O filtro de contrato só se aplica à aba Empresas.
  const contractActive =
    tab === "empresa" && contractFilter !== "todos" ? contractFilter === "ativos" : undefined;

  const { data: contacts, isLoading } = useQuery({
    queryKey: ["contacts", tab, search, contractActive],
    queryFn: () => listContacts({ type: tab, search: search || undefined, contractActive }),
  });
  const { data: labels } = useQuery({ queryKey: ["contacts", "labels"], queryFn: listLabels });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["contacts"] });
  const columnCount = tab === "pessoa" ? 5 : 7;

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Typography variant="h5">Contatos</Typography>
        <Button startIcon={<AddIcon />} variant="contained" onClick={() => setDialogOpen(true)}>
          {tab === "pessoa" ? "Nova pessoa" : "Nova empresa"}
        </Button>
      </Stack>

      <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 2 }}>
        <Tabs value={tab} onChange={(_e, v) => setTab(v)}>
          <Tab label="Pessoas" value="pessoa" />
          <Tab label="Empresas" value="empresa" />
        </Tabs>
        {tab === "empresa" && (
          <TextField
            select
            size="small"
            label="Contrato"
            value={contractFilter}
            onChange={(e) => setContractFilter(e.target.value as ContractFilter)}
            sx={{ ml: 2, width: 180 }}
          >
            <MenuItem value="todos">Todos</MenuItem>
            <MenuItem value="ativos">Contrato ativo</MenuItem>
            <MenuItem value="inativos">Sem contrato ativo</MenuItem>
          </TextField>
        )}
        <TextField size="small" placeholder="Buscar…" value={search} onChange={(e) => setSearch(e.target.value)} sx={{ ml: "auto", width: 280 }} />
      </Stack>

      {isLoading ? (
        <Box sx={{ display: "grid", placeItems: "center", height: 200 }}><CircularProgress /></Box>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>{tab === "pessoa" ? "Nome" : "Razão social"}</TableCell>
                <TableCell>{tab === "pessoa" ? "E-mail" : "CNPJ"}</TableCell>
                {tab === "pessoa" ? (
                  <TableCell>Telefone</TableCell>
                ) : (
                  <>
                    <TableCell>Cidade/UF</TableCell>
                    <TableCell>Gerente de contas</TableCell>
                    <TableCell>Contrato</TableCell>
                  </>
                )}
                <TableCell>Rótulos</TableCell>
                <TableCell align="right">Ações</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(contacts ?? []).map((c) => (
                <ContactRow key={c.id} contact={c} labels={labels ?? []} onChange={invalidate} onOpen={() => setDetailContact(c)} />
              ))}
              {(contacts ?? []).length === 0 && (
                <TableRow><TableCell colSpan={columnCount}><Typography color="text.secondary">Nenhum contato.</Typography></TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {tab === "pessoa" ? (
        <NewPersonDialog open={dialogOpen} onClose={() => setDialogOpen(false)} onDone={invalidate} />
      ) : (
        <NewCompanyDialog open={dialogOpen} onClose={() => setDialogOpen(false)} onDone={invalidate} />
      )}

      {detailContact && (detailContact.contact_type === "empresa" ? (
        <CompanyDetailDialog
          company={detailContact}
          onClose={() => setDetailContact(null)}
          onSaved={invalidate}
        />
      ) : (
        <ContactDetailDialog contact={detailContact} onClose={() => setDetailContact(null)} />
      ))}
    </Box>
  );
}

/** Linha de contato com rótulos editáveis inline e botão de detalhes/ações. */
function ContactRow({ contact, labels, onChange, onOpen }: { contact: ContactListItem; labels: { id: string; name: string }[]; onChange: () => void; onOpen: () => void }): JSX.Element {
  const qc = useQueryClient();
  const assign = useMutation({
    mutationFn: (categoryId: string) => assignLabel(contact.id, categoryId),
    onSuccess: onChange,
  });
  const unassign = useMutation({
    mutationFn: (categoryId: string) => unassignLabel(contact.id, categoryId),
    onSuccess: onChange,
  });
  const create = useMutation({
    mutationFn: (name: string) => createLabel(name),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["contacts", "labels"] }),
  });

  const [adding, setAdding] = useState(false);
  const available = labels.filter((l) => !contact.labels.some((cl) => cl.id === l.id));
  const isPerson = contact.contact_type === "pessoa";
  const location = [contact.city, contact.state].filter(Boolean).join("/");

  return (
    <TableRow hover>
      <TableCell>{isPerson ? contact.full_name : contact.legal_name}</TableCell>
      <TableCell>{isPerson ? contact.email : contact.fiscal_document}</TableCell>
      {isPerson ? (
        <TableCell>{contact.phone ?? "—"}</TableCell>
      ) : (
        <>
          <TableCell>{location || "—"}</TableCell>
          <TableCell>{contact.account_manager_name ?? "—"}</TableCell>
          <TableCell>
            <Chip
              size="small"
              color={contact.contract_active ? "success" : "default"}
              label={contact.contract_active ? "Ativo" : "Inativo"}
            />
          </TableCell>
        </>
      )}
      <TableCell>
        <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap alignItems="center">
          {contact.labels.map((l) => (
            <Chip key={l.id} size="small" label={l.name} onDelete={() => unassign.mutate(l.id)} />
          ))}
          {adding ? (
            <TextField
              select
              size="small"
              sx={{ width: 200 }}
              defaultValue=""
              autoFocus
              onChange={(e) => {
                const v = e.target.value;
                if (v === "__new__") {
                  const name = window.prompt("Nome do novo rótulo:")?.trim();
                  if (name) create.mutateAsync(name).then((cat) => assign.mutate(cat.id));
                } else if (v) {
                  assign.mutate(v);
                }
                setAdding(false);
              }}
              onBlur={() => setAdding(false)}
            >
              <MenuItem value="">Selecione…</MenuItem>
              {available.map((l) => <MenuItem key={l.id} value={l.id}>{l.name}</MenuItem>)}
              <MenuItem value="__new__">+ Novo rótulo…</MenuItem>
            </TextField>
          ) : (
            <Chip size="small" variant="outlined" icon={<AddIcon />} label="rótulo" onClick={() => setAdding(true)} />
          )}
        </Stack>
      </TableCell>
      <TableCell align="right">
        <Tooltip title={isPerson ? "Detalhes, ações e campos personalizados" : "Dados cadastrais, contatos vinculados e campos personalizados"}>
          <IconButton size="small" onClick={onOpen}><TuneIcon fontSize="small" /></IconButton>
        </Tooltip>
      </TableCell>
    </TableRow>
  );
}

/** Diálogo de criação de pessoa. */
function NewPersonDialog({
  open, onClose, onDone,
}: {
  open: boolean; onClose: () => void; onDone: () => void;
}): JSX.Element {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => createPerson({ full_name: fullName.trim(), email: email.trim(), phone }),
    onSuccess: () => { onDone(); onClose(); setFullName(""); setEmail(""); setPhone(""); },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Falha ao criar contato."),
  });

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Nova pessoa</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
          <TextField label="Nome completo" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
          <TextField label="E-mail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <PhoneField label="Telefone" value={phone} onChange={setPhone} required />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancelar</Button>
        <Button variant="contained" onClick={() => create.mutate()} disabled={create.isPending}>Criar</Button>
      </DialogActions>
    </Dialog>
  );
}

/**
 * Diálogo de detalhes de uma PESSOA: ações de comunicação (WhatsApp, ligação
 * via PABX, SMS) e edição dos campos personalizados.
 */
function ContactDetailDialog({ contact, onClose }: { contact: ContactListItem; onClose: () => void }): JSX.Element {
  const phone = contact.phone ?? "";
  const displayName = contact.full_name ?? "";
  const [feedback, setFeedback] = useState<FieldFeedback | null>(null);
  const [waText, setWaText] = useState("");
  const [smsText, setSmsText] = useState("");

  const wa = useMutation({
    mutationFn: () => sendWhatsapp(phone, waText || `Olá ${displayName}`),
    onSuccess: () => { setFeedback({ ok: true, text: "WhatsApp enviado." }); setWaText(""); },
    onError: (e) => setFeedback({ ok: false, text: e instanceof ApiError ? e.message : "Falha ao enviar WhatsApp." }),
  });
  const sms = useMutation({
    mutationFn: () => sendSms(phone, smsText || `Olá ${displayName}`),
    onSuccess: () => { setFeedback({ ok: true, text: "SMS enviado." }); setSmsText(""); },
    onError: (e) => setFeedback({ ok: false, text: e instanceof ApiError ? e.message : "Falha ao enviar SMS." }),
  });
  const call = useMutation({
    mutationFn: () => requestCall(phone, displayName),
    onSuccess: () => setFeedback({ ok: true, text: "Chamada solicitada ao PABX. Aguarde o retorno no seu ramal." }),
    onError: (e) => setFeedback({ ok: false, text: e instanceof ApiError ? e.message : "Falha ao solicitar a chamada." }),
  });

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{displayName || "Contato"}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {feedback && <Alert severity={feedback.ok ? "success" : "error"} onClose={() => setFeedback(null)}>{feedback.text}</Alert>}

          <Box>
            <Typography variant="subtitle2" gutterBottom>Ações de comunicação</Typography>
            {phone ? (
              <>
                <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
                  <Button size="small" variant="outlined" color="success" startIcon={<WhatsAppIcon />} onClick={() => wa.mutate()} disabled={wa.isPending}>
                    WhatsApp
                  </Button>
                  <Button size="small" variant="outlined" startIcon={<CallIcon />} onClick={() => call.mutate()} disabled={call.isPending}>
                    Ligar
                  </Button>
                  <Button size="small" variant="outlined" startIcon={<SmsIcon />} onClick={() => sms.mutate()} disabled={sms.isPending}>
                    SMS
                  </Button>
                </Stack>
                <Stack spacing={1}>
                  <TextField size="small" label="Mensagem de WhatsApp (opcional)" value={waText} onChange={(e) => setWaText(e.target.value)} fullWidth />
                  <TextField size="small" label="Texto do SMS (opcional)" value={smsText} onChange={(e) => setSmsText(e.target.value)} fullWidth />
                </Stack>
              </>
            ) : (
              <Typography variant="caption" color="text.secondary">Sem telefone cadastrado para este contato.</Typography>
            )}
          </Box>

          <Divider />

          <Box>
            <Typography variant="subtitle2" gutterBottom>Campos personalizados</Typography>
            <CustomFieldsEditor contactId={contact.id} onFeedback={setFeedback} />
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Fechar</Button>
      </DialogActions>
    </Dialog>
  );
}
