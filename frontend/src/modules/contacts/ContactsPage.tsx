/**
 * @file ContactsPage.tsx
 * @module modules/contacts
 *
 * Gestão da Base Central de Contatos: lista pessoas e empresas (leads ou não),
 * com busca, rótulos (labels) e criação. É a fundação de contatos reutilizada
 * por CRM, Projetos e campanhas.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Box, Typography, Stack, Button, Tabs, Tab, TextField, Table, TableBody, TableCell, TableHead,
  TableRow, Paper, TableContainer, CircularProgress, Dialog, DialogTitle, DialogContent, DialogActions,
  Chip, MenuItem, Alert, IconButton, Tooltip, Divider, Switch, FormControlLabel,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import TuneIcon from "@mui/icons-material/Tune";
import WhatsAppIcon from "@mui/icons-material/WhatsApp";
import CallIcon from "@mui/icons-material/Call";
import SmsIcon from "@mui/icons-material/Sms";
import DeleteIcon from "@mui/icons-material/Delete";
import {
  listContacts, createPerson, createCompany, listLabels, createLabel, assignLabel, unassignLabel,
  lookupCnpj, type ContactListItem,
  listCustomFieldDefs, listContactCustomFields, setContactCustomField, clearContactCustomField,
  type CustomFieldDataType,
} from "../../core/api/contacts.js";
import { sendWhatsapp, sendSms, requestCall } from "../../core/api/comms.js";
import { PhoneField } from "../../core/ui/PhoneField.js";
import { ApiError } from "../../core/api/client.js";

/**
 * Página de gestão de contatos.
 *
 * @returns A tela de contatos.
 */
export function ContactsPage(): JSX.Element {
  const qc = useQueryClient();
  const [tab, setTab] = useState<"pessoa" | "empresa">("pessoa");
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [detailContact, setDetailContact] = useState<ContactListItem | null>(null);

  const { data: contacts, isLoading } = useQuery({
    queryKey: ["contacts", tab, search],
    queryFn: () => listContacts({ type: tab, search: search || undefined }),
  });
  const { data: labels } = useQuery({ queryKey: ["contacts", "labels"], queryFn: listLabels });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["contacts"] });

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
                {tab === "pessoa" && <TableCell>Telefone</TableCell>}
                <TableCell>Rótulos</TableCell>
                <TableCell align="right">Ações</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(contacts ?? []).map((c) => (
                <ContactRow key={c.id} contact={c} labels={labels ?? []} onChange={invalidate} onOpen={() => setDetailContact(c)} />
              ))}
              {(contacts ?? []).length === 0 && (
                <TableRow><TableCell colSpan={5}><Typography color="text.secondary">Nenhum contato.</Typography></TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <NewContactDialog type={tab} open={dialogOpen} onClose={() => setDialogOpen(false)} onDone={invalidate} />
      {detailContact && <ContactDetailDialog contact={detailContact} onClose={() => setDetailContact(null)} />}
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

  return (
    <TableRow hover>
      <TableCell>{contact.contact_type === "pessoa" ? contact.full_name : contact.legal_name}</TableCell>
      <TableCell>{contact.contact_type === "pessoa" ? contact.email : contact.fiscal_document}</TableCell>
      {contact.contact_type === "pessoa" && <TableCell>{contact.phone ?? "—"}</TableCell>}
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
        <Tooltip title="Detalhes, ações e campos personalizados">
          <IconButton size="small" onClick={onOpen}><TuneIcon fontSize="small" /></IconButton>
        </Tooltip>
      </TableCell>
    </TableRow>
  );
}

/** Diálogo de criação de pessoa ou empresa. */
function NewContactDialog({
  type, open, onClose, onDone,
}: {
  type: "pessoa" | "empresa"; open: boolean; onClose: () => void; onDone: () => void;
}): JSX.Element {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [legalName, setLegalName] = useState("");
  const [cnpj, setCnpj] = useState("");
  const [lookup, setLookup] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => type === "pessoa"
      ? createPerson({ full_name: fullName.trim(), email: email.trim(), phone })
      : createCompany({ legal_name: legalName.trim(), fiscal_document: cnpj.replace(/\D/g, "") }),
    onSuccess: () => { onDone(); onClose(); setFullName(""); setEmail(""); setPhone(""); setLegalName(""); setCnpj(""); },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Falha ao criar contato."),
  });

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{type === "pessoa" ? "Nova pessoa" : "Nova empresa"}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
          {type === "pessoa" ? (
            <>
              <TextField label="Nome completo" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
              <TextField label="E-mail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              <PhoneField label="Telefone" value={phone} onChange={setPhone} required />
            </>
          ) : (
            <>
              <TextField
                label="CNPJ"
                value={cnpj}
                onChange={(e) => setCnpj(e.target.value)}
                onBlur={async () => {
                  if (cnpj.replace(/\D/g, "").length !== 14) return;
                  setLookup(true);
                  const data = await lookupCnpj(cnpj);
                  setLookup(false);
                  if (data?.legal_name && !legalName) setLegalName(data.legal_name);
                }}
                placeholder="00.000.000/0000-00"
                helperText={lookup ? "Consultando dados oficiais…" : "Ao sair do campo, buscamos os dados oficiais (editáveis)."}
                required
                autoFocus
              />
              <TextField label="Razão social" value={legalName} onChange={(e) => setLegalName(e.target.value)} required />
            </>
          )}
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
 * Diálogo de detalhes do contato: ações de comunicação (WhatsApp, ligação via
 * PABX, SMS) e edição dos campos personalizados. Reúne #5 (valores de campos
 * personalizados) e #6 (botões de ação) num único lugar.
 */
function ContactDetailDialog({ contact, onClose }: { contact: ContactListItem; onClose: () => void }): JSX.Element {
  const isPerson = contact.contact_type === "pessoa";
  const phone = contact.phone ?? "";
  const displayName = isPerson ? contact.full_name ?? "" : contact.legal_name ?? "";
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
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

          {isPerson && (
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
          )}

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

/**
 * Editor dos valores de campos personalizados de um contato. Lista todas as
 * definições e permite atribuir/limpar valores conforme o tipo.
 */
function CustomFieldsEditor({
  contactId, onFeedback,
}: {
  contactId: string; onFeedback: (f: { ok: boolean; text: string }) => void;
}): JSX.Element {
  const qc = useQueryClient();
  const { data: defs } = useQuery({ queryKey: ["custom-fields"], queryFn: listCustomFieldDefs });
  const { data: values, isLoading } = useQuery({
    queryKey: ["contacts", contactId, "custom-fields"],
    queryFn: () => listContactCustomFields(contactId),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["contacts", contactId, "custom-fields"] });

  const save = useMutation({
    mutationFn: ({ fieldId, value }: { fieldId: string; value: unknown }) => setContactCustomField(contactId, fieldId, value),
    onSuccess: () => { invalidate(); onFeedback({ ok: true, text: "Campo salvo." }); },
    onError: (e) => onFeedback({ ok: false, text: e instanceof ApiError ? e.message : "Falha ao salvar campo." }),
  });
  const clear = useMutation({
    mutationFn: (fieldId: string) => clearContactCustomField(contactId, fieldId),
    onSuccess: () => { invalidate(); onFeedback({ ok: true, text: "Campo removido." }); },
  });

  if (isLoading) return <CircularProgress size={20} />;
  if ((defs ?? []).length === 0) {
    return <Typography variant="caption" color="text.secondary">Nenhum campo cadastrado. Crie em Administração → Campos personalizados.</Typography>;
  }

  const valueByField = new Map((values ?? []).map((v) => [v.field_id, v.value]));

  return (
    <Stack spacing={1.5}>
      {(defs ?? []).map((d) => (
        <CustomFieldRow
          key={d.id}
          name={d.name}
          dataType={d.data_type}
          current={valueByField.get(d.id)}
          onSave={(value) => save.mutate({ fieldId: d.id, value })}
          onClear={() => clear.mutate(d.id)}
        />
      ))}
    </Stack>
  );
}

/** Uma linha de edição de campo personalizado, tipada conforme o data_type. */
function CustomFieldRow({
  name, dataType, current, onSave, onClear,
}: {
  name: string;
  dataType: CustomFieldDataType;
  current: unknown;
  onSave: (value: unknown) => void;
  onClear: () => void;
}): JSX.Element {
  const [text, setText] = useState(() => {
    if (current == null) return "";
    return dataType === "boolean" ? "" : String(current);
  });
  const [bool, setBool] = useState<boolean>(current === true);

  function commit(): void {
    if (dataType === "text") onSave(text);
    else if (dataType === "number") { const n = Number(text); if (Number.isFinite(n)) onSave(n); }
    else if (dataType === "date") onSave(text); // YYYY-MM-DD; validado no backend
  }

  return (
    <Stack direction="row" spacing={1} alignItems="center">
      <Typography variant="body2" sx={{ minWidth: 160 }}>{name}</Typography>
      {dataType === "boolean" ? (
        <FormControlLabel
          control={<Switch checked={bool} onChange={(e) => { setBool(e.target.checked); onSave(e.target.checked); }} />}
          label={bool ? "Sim" : "Não"}
        />
      ) : (
        <>
          <TextField
            size="small"
            type={dataType === "number" ? "number" : dataType === "date" ? "date" : "text"}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={commit}
            {...(dataType === "date" ? { InputLabelProps: { shrink: true } } : {})}
            fullWidth
          />
          <Tooltip title="Limpar valor">
            <IconButton size="small" onClick={onClear} aria-label={`Limpar ${name}`}><DeleteIcon fontSize="small" /></IconButton>
          </Tooltip>
        </>
      )}
    </Stack>
  );
}
