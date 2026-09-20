/**
 * @file CustomFieldsPage.tsx
 * @module modules/admin
 *
 * Gestão das definições de campos personalizados de contatos (Req 4). Permite
 * cadastrar campos tipados (texto, número, booleano, data) para enriquecer os
 * contatos com informações detalhadas (ex.: "escola dos filhos"). Exige
 * `core:config:gerenciar`.
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
  listCustomFieldDefs, createCustomFieldDef, deleteCustomFieldDef, type CustomFieldDataType,
} from "../../core/api/contacts.js";
import { ApiError } from "../../core/api/client.js";

/** Rótulos amigáveis dos tipos de dado. */
const TYPE_LABELS: Record<CustomFieldDataType, string> = {
  text: "Texto",
  number: "Número",
  boolean: "Sim/Não",
  date: "Data",
};

/**
 * Página de gestão de campos personalizados de contatos.
 *
 * @returns A tela de campos personalizados.
 */
export function CustomFieldsPage(): JSX.Element {
  const qc = useQueryClient();
  const { data: defs, isLoading } = useQuery({ queryKey: ["custom-fields"], queryFn: listCustomFieldDefs });
  const [name, setName] = useState("");
  const [dataType, setDataType] = useState<CustomFieldDataType>("text");
  const [error, setError] = useState<string | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["custom-fields"] });

  const create = useMutation({
    mutationFn: () => createCustomFieldDef(name.trim(), dataType),
    onSuccess: () => { setName(""); setDataType("text"); invalidate(); },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Falha ao criar campo."),
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteCustomFieldDef(id),
    onSuccess: invalidate,
    onError: (e) => setError(e instanceof ApiError ? e.message : "Falha ao remover campo."),
  });

  if (isLoading) {
    return <Box sx={{ display: "grid", placeItems: "center", height: 200 }}><CircularProgress /></Box>;
  }

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 0.5 }}>Campos personalizados</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Crie campos tipados para enriquecer os contatos com informações detalhadas (ex.: escola dos filhos, hobby).
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <TextField
            size="small"
            label="Nome do campo"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="escola_dos_filhos"
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
              <TableRow><TableCell colSpan={3}><Typography color="text.secondary">Nenhum campo personalizado.</Typography></TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}
