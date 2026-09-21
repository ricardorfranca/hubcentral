/**
 * @file ExportWizardPage.tsx
 * @module modules/admin
 *
 * Assistente de Exportação de Dados (Contatos). Permite escolher o formato
 * (CSV, XLSX, JSON), filtrar por tipo e rótulo, e selecionar quais colunas
 * padrão e campos personalizados incluir. Restrito ao SuperAdministrador.
 */

import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Box, Typography, Paper, Stack, TextField, MenuItem, Button, FormGroup, FormControlLabel,
  Checkbox, CircularProgress, Alert, Divider, Autocomplete, Chip, ToggleButton, ToggleButtonGroup,
} from "@mui/material";
import DownloadIcon from "@mui/icons-material/Download";
import {
  getExportMetadata, downloadExport,
  type IoFormat, type StandardExportColumn,
} from "../../core/api/import-export.js";
import { textFieldParams } from "./mui-utils.js";

/** Rótulos amigáveis das colunas padrão. */
const COLUMN_LABELS: Record<StandardExportColumn, string> = {
  id: "ID",
  contact_type: "Tipo",
  full_name: "Nome completo",
  email: "E-mail",
  phone: "Telefone",
  legal_name: "Razão social",
  fiscal_document: "Documento fiscal",
  labels: "Rótulos",
  created_at: "Criado em",
  updated_at: "Atualizado em",
};

/** Página do Assistente de Exportação de Contatos. */
export function ExportWizardPage(): JSX.Element {
  const { data: meta, isLoading } = useQuery({ queryKey: ["export-metadata"], queryFn: getExportMetadata });

  const [format, setFormat] = useState<IoFormat>("csv");
  const [type, setType] = useState<"" | "pessoa" | "empresa">("");
  const [labelId, setLabelId] = useState<string>("");
  const [search, setSearch] = useState("");
  const [selectedColumns, setSelectedColumns] = useState<StandardExportColumn[]>([]);
  const [selectedFields, setSelectedFields] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Seleciona todas as colunas padrão por default quando os metadados chegam.
  useEffect(() => {
    if (meta && selectedColumns.length === 0) {
      setSelectedColumns([...meta.standard_columns]);
    }
  }, [meta]); // eslint-disable-line react-hooks/exhaustive-deps

  const exportMut = useMutation({
    mutationFn: () =>
      downloadExport({
        format,
        filters: {
          ...(type ? { type } : {}),
          ...(labelId ? { label_id: labelId } : {}),
          ...(search.trim() ? { search: search.trim() } : {}),
        },
        standard_columns: selectedColumns,
        custom_field_ids: selectedFields,
      }),
    onError: (e) => setError(e instanceof Error ? e.message : "Falha ao exportar."),
    onSuccess: () => setError(null),
  });

  function toggleColumn(col: StandardExportColumn): void {
    setSelectedColumns((prev) => (prev.includes(col) ? prev.filter((c) => c !== col) : [...prev, col]));
  }
  function toggleField(id: string): void {
    setSelectedFields((prev) => (prev.includes(id) ? prev.filter((f) => f !== id) : [...prev, id]));
  }

  if (isLoading || !meta) {
    return <Box sx={{ display: "grid", placeItems: "center", height: 200 }}><CircularProgress /></Box>;
  }

  const noColumns = selectedColumns.length === 0 && selectedFields.length === 0;

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 0.5 }}>Assistente de Exportação</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Exporte contatos em CSV, XLSX ou JSON. Filtre por tipo e rótulo e escolha exatamente quais
        colunas e campos personalizados incluir.
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

      <Paper variant="outlined" sx={{ p: 3 }}>
        <Stack spacing={3}>
          <Box>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>Formato</Typography>
            <ToggleButtonGroup
              exclusive
              size="small"
              value={format}
              onChange={(_e, v) => v && setFormat(v as IoFormat)}
            >
              <ToggleButton value="csv">CSV</ToggleButton>
              <ToggleButton value="xlsx">XLSX (Excel)</ToggleButton>
              <ToggleButton value="json">JSON</ToggleButton>
            </ToggleButtonGroup>
          </Box>

          <Divider />

          <Box>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>Filtros</Typography>
            <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
              <TextField
                select size="small" label="Tipo" value={type}
                onChange={(e) => setType(e.target.value as "" | "pessoa" | "empresa")}
                sx={{ width: 160 }}
              >
                <MenuItem value="">Todos</MenuItem>
                <MenuItem value="pessoa">Pessoas</MenuItem>
                <MenuItem value="empresa">Empresas</MenuItem>
              </TextField>
              <Autocomplete
                size="small"
                sx={{ width: 220 }}
                options={meta.labels}
                getOptionLabel={(o) => o.name}
                value={meta.labels.find((l) => l.id === labelId) ?? null}
                onChange={(_e, v) => setLabelId(v?.id ?? "")}
                renderInput={(params) => <TextField {...textFieldParams(params)} label="Rótulo" />}
              />
              <TextField
                size="small" label="Busca" value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="nome, e-mail, documento…" sx={{ width: 240 }}
              />
            </Stack>
          </Box>

          <Divider />

          <Box>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>Colunas padrão</Typography>
            <FormGroup row>
              {meta.standard_columns.map((col) => (
                <FormControlLabel
                  key={col}
                  control={<Checkbox size="small" checked={selectedColumns.includes(col)} onChange={() => toggleColumn(col)} />}
                  label={COLUMN_LABELS[col] ?? col}
                />
              ))}
            </FormGroup>
          </Box>

          {meta.custom_fields.length > 0 && (
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>Campos personalizados</Typography>
              <FormGroup row>
                {meta.custom_fields.map((cf) => (
                  <FormControlLabel
                    key={cf.id}
                    control={<Checkbox size="small" checked={selectedFields.includes(cf.id)} onChange={() => toggleField(cf.id)} />}
                    label={<Chip size="small" label={cf.name} />}
                  />
                ))}
              </FormGroup>
            </Box>
          )}

          {noColumns && <Alert severity="warning">Selecione ao menos uma coluna ou campo para exportar.</Alert>}

          <Box>
            <Button
              variant="contained"
              startIcon={exportMut.isPending ? <CircularProgress size={16} /> : <DownloadIcon />}
              disabled={exportMut.isPending || noColumns}
              onClick={() => exportMut.mutate()}
            >
              Exportar e baixar
            </Button>
          </Box>
        </Stack>
      </Paper>
    </Box>
  );
}
