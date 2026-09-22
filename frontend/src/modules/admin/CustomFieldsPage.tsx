/**
 * @file CustomFieldsPage.tsx
 * @module modules/admin
 *
 * Gestão das definições de campos personalizados, módulo a módulo (por
 * entidade). Permite cadastrar campos tipados (texto, número, booleano, data)
 * para enriquecer contatos, oportunidades do CRM e tarefas de Projetos. A
 * gestão das definições é exclusiva do SuperAdministrador (SuperadminGuard +
 * backend). Os valores são preenchidos nas telas de cada entidade.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Box, Typography, Button, Stack, Table, TableHead, TableRow, TableCell, TableBody,
  TextField, MenuItem, IconButton, Tooltip, Alert, CircularProgress, Chip, Paper, TableContainer,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import {
  listCustomFieldDefs, createCustomFieldDef, deleteCustomFieldDef,
  type CustomFieldDataType, type CustomFieldEntity,
} from "../../core/api/contacts.js";
import { ApiError } from "../../core/api/client.js";
import { SuperadminGuard } from "./SuperadminGuard.js";

/** Rótulos amigáveis dos tipos de dado. */
const TYPE_LABELS: Record<CustomFieldDataType, string> = {
  text: "Texto",
  number: "Número",
  boolean: "Sim/Não",
  date: "Data",
};

/** Entidades disponíveis (módulo a módulo) e seus rótulos. */
const ENTITIES: { id: CustomFieldEntity; label: string; hint: string }[] = [
  { id: "contact", label: "Contatos", hint: "Pessoas e empresas da Base Central de Contatos." },
  { id: "crm_opportunity", label: "CRM — Oportunidades", hint: "Negociações do funil de vendas." },
  { id: "projetos_task", label: "Projetos — Tarefas", hint: "Cartões do quadro Kanban de projetos." },
];

/**
 * Página de gestão de campos personalizados por módulo. Protegida para
 * SuperAdministradores.
 *
 * @returns A tela de campos personalizados.
 */
export function CustomFieldsPage(): JSX.Element {
  return (
    <SuperadminGuard>
      <CustomFieldsManager />
    </SuperadminGuard>
  );
}

/** Conteúdo da página (já dentro do guard). */
function CustomFieldsManager(): JSX.Element {
  const qc = useQueryClient();
  const [entity, setEntity] = useState<CustomFieldEntity>("contact");
  const { data: defs, isLoading } = useQuery({
    queryKey: ["custom-fields", entity],
    queryFn: () => listCustomFieldDefs(entity),
  });
  const [name, setName] = useState("");
  const [dataType, setDataType] = useState<CustomFieldDataType>("text");
  const [error, setError] = useState<string | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["custom-fields", entity] });

  const create = useMutation({
    mutationFn: () => createCustomFieldDef(name.trim(), dataType, entity),
    onSuccess: () => { setName(""); setDataType("text"); invalidate(); },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Falha ao criar campo."),
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteCustomFieldDef(id),
    onSuccess: invalidate,
    onError: (e) => setError(e instanceof ApiError ? e.message : "Falha ao remover campo."),
  });

  const currentEntity = ENTITIES.find((e) => e.id === entity)!;

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 0.5 }}>Campos personalizados</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Crie campos tipados por módulo para enriquecer os registros com informações detalhadas.
        Os valores são preenchidos nas telas de cada módulo. A gestão dos campos é exclusiva do SuperAdministrador.
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <TextField
            select
            size="small"
            label="Módulo / entidade"
            value={entity}
            onChange={(e) => { setEntity(e.target.value as CustomFieldEntity); setError(null); }}
            sx={{ minWidth: 220 }}
          >
            {ENTITIES.map((e) => <MenuItem key={e.id} value={e.id}>{e.label}</MenuItem>)}
          </TextField>
        </Stack>
        <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: "block" }}>
          {currentEntity.hint}
        </Typography>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <TextField
            size="small"
            label="Nome do campo"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="origem_campanha"
            sx={{ minWidth: 240 }}
          />
          <TextField
            select
            size="small"
            label="Tipo"
            value={dataType}
            onChange={(e) => setDataType(e.target.value as CustomFieldDataType)}
            sx={{ width: 160 }}
          >
            {(Object.keys(TYPE_LABELS) as CustomFieldDataType[]).map((t) => (
              <MenuItem key={t} value={t}>{TYPE_LABELS[t]}</MenuItem>
            ))}
          </TextField>
          <Button
            startIcon={<AddIcon />}
            variant="contained"
            onClick={() => create.mutate()}
            disabled={create.isPending || name.trim() === ""}
          >
            Adicionar
          </Button>
        </Stack>
      </Paper>

      {isLoading ? (
        <Box sx={{ display: "grid", placeItems: "center", height: 160 }}><CircularProgress /></Box>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Nome</TableCell>
                <TableCell>Tipo</TableCell>
                <TableCell align="right">Ações</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(defs ?? []).map((d) => (
                <TableRow key={d.id}>
                  <TableCell>{d.name}</TableCell>
                  <TableCell><Chip size="small" label={TYPE_LABELS[d.data_type]} /></TableCell>
                  <TableCell align="right">
                    <Tooltip title="Remover campo (e seus valores)">
                      <IconButton size="small" color="error" onClick={() => remove.mutate(d.id)}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
              {(defs ?? []).length === 0 && (
                <TableRow><TableCell colSpan={3}><Typography color="text.secondary">Nenhum campo personalizado para {currentEntity.label}.</Typography></TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Box>
  );
}
