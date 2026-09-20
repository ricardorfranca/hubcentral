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
  Chip, MenuItem, Alert,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import {
  listContacts, createPerson, createCompany, listLabels, createLabel, assignLabel, unassignLabel,
  lookupCnpj, type ContactListItem,
} from "../../core/api/contacts.js";
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
              </TableRow>
            </TableHead>
            <TableBody>
              {(contacts ?? []).map((c) => (
                <ContactRow key={c.id} contact={c} labels={labels ?? []} onChange={invalidate} />
              ))}
              {(contacts ?? []).length === 0 && (
                <TableRow><TableCell colSpan={4}><Typography color="text.secondary">Nenhum contato.</Typography></TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <NewContactDialog type={tab} open={dialogOpen} onClose={() => setDialogOpen(false)} onDone={invalidate} />
    </Box>
  );
}

/** Linha de contato com rótulos editáveis inline. */
function ContactRow({ contact, labels, onChange }: { contact: ContactListItem; labels: { id: string; name: string }[]; onChange: () => void }): JSX.Element {
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
