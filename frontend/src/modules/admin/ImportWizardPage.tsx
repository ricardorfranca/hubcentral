/**
 * @file ImportWizardPage.tsx
 * @module modules/admin
 *
 * Assistente de Importação de Dados (Contatos). Fluxo em etapas:
 *  1. Enviar arquivo (CSV, XLSX ou JSON) e escolher o tipo de contato.
 *  2. Mapear cada coluna do arquivo para um campo padrão, um campo
 *     personalizado (existente ou novo) ou ignorá-la.
 *  3. Escolher rótulos para marcar todos os registros e a estratégia de
 *     duplicatas.
 *  4. Executar e ver o relatório (criados, atualizados, ignorados, rejeitados).
 *
 * Restrito ao SuperAdministrador (o backend também impõe essa restrição).
 */

import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Box, Typography, Stepper, Step, StepLabel, Button, Stack, Paper, Alert, CircularProgress,
  Table, TableHead, TableRow, TableCell, TableBody, TableContainer, TextField, MenuItem,
  ToggleButton, ToggleButtonGroup, Chip, Autocomplete, Divider, Card, CardContent, Tooltip,
} from "@mui/material";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import DownloadIcon from "@mui/icons-material/Download";
import { listLabels, type CustomFieldDataType } from "../../core/api/contacts.js";
import { textFieldParams } from "./mui-utils.js";
import {
  previewImport, runImport, downloadRejectedReport,
  type ImportPreview, type ColumnMapping, type StandardField, type DuplicateStrategy,
  type ContactsImportResult,
} from "../../core/api/import-export.js";

/** Alvo escolhido para cada coluna, na UI. */
type MappingChoice =
  | { kind: "ignore" }
  | { kind: "standard"; field: StandardField }
  | { kind: "custom_existing"; fieldId: string }
  | { kind: "custom_new"; name: string; dataType: CustomFieldDataType };

/** Rótulos amigáveis dos campos padrão por tipo de contato. */
const STANDARD_LABELS: Record<StandardField, string> = {
  full_name: "Nome completo",
  email: "E-mail",
  phone: "Telefone",
  legal_name: "Razão social",
  fiscal_document: "Documento fiscal",
};

/** Campos padrão relevantes por tipo de contato. */
const FIELDS_BY_TYPE: Record<"pessoa" | "empresa", StandardField[]> = {
  pessoa: ["full_name", "email", "phone"],
  empresa: ["legal_name", "fiscal_document"],
};

const STEPS = ["Arquivo", "Mapeamento", "Rótulos e duplicatas", "Resultado"];

/** Página do Assistente de Importação de Contatos. */
export function ImportWizardPage(): JSX.Element {
  const [activeStep, setActiveStep] = useState(0);
  const [contactType, setContactType] = useState<"pessoa" | "empresa">("pessoa");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [choices, setChoices] = useState<Record<string, MappingChoice>>({});
  const [labelIds, setLabelIds] = useState<string[]>([]);
  const [dedup, setDedup] = useState<DuplicateStrategy>("skip");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ContactsImportResult | null>(null);

  const { data: labels } = useQuery({ queryKey: ["labels"], queryFn: listLabels });

  const previewMut = useMutation({
    mutationFn: (f: File) => previewImport(f),
    onSuccess: (data) => {
      setPreview(data);
      // Auto-mapeia colunas cujo nome bate com um campo padrão ou personalizado.
      const auto: Record<string, MappingChoice> = {};
      for (const h of data.headers) {
        const norm = h.trim().toLowerCase();
        const std = (Object.keys(STANDARD_LABELS) as StandardField[]).find(
          (f) => f === norm || STANDARD_LABELS[f].toLowerCase() === norm,
        );
        const cf = data.custom_fields.find((c) => c.name.toLowerCase() === norm);
        if (std) auto[h] = { kind: "standard", field: std };
        else if (cf) auto[h] = { kind: "custom_existing", fieldId: cf.id };
        else auto[h] = { kind: "ignore" };
      }
      setChoices(auto);
      setError(null);
      setActiveStep(1);
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Falha ao ler o arquivo."),
  });

  const importMut = useMutation({
    mutationFn: () => {
      if (!preview) throw new Error("Sem dados para importar.");
      const mappings: ColumnMapping[] = preview.headers.map((column) => {
        const c = choices[column] ?? { kind: "ignore" };
        switch (c.kind) {
          case "standard":
            return { column, target: "standard", field: c.field };
          case "custom_existing":
            return { column, target: "custom_existing", fieldId: c.fieldId };
          case "custom_new":
            return { column, target: "custom_new", name: c.name, dataType: c.dataType };
          default:
            return { column, target: "ignore" };
        }
      });
      return runImport({
        contact_type: contactType,
        rows: preview.rows,
        mappings,
        label_ids: labelIds,
        duplicate_strategy: dedup,
      });
    },
    onSuccess: (data) => {
      setResult(data);
      setError(null);
      setActiveStep(3);
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Falha na importação."),
  });

  // Validação do mapeamento: todos os campos obrigatórios do tipo devem estar cobertos.
  const requiredFields = FIELDS_BY_TYPE[contactType];
  const mappedStandard = useMemo(() => {
    const set = new Set<StandardField>();
    for (const c of Object.values(choices)) {
      if (c.kind === "standard") set.add(c.field);
    }
    return set;
  }, [choices]);
  const missingRequired = requiredFields.filter((f) => !mappedStandard.has(f));
  const mappingValid = missingRequired.length === 0;

  function reset(): void {
    setActiveStep(0);
    setFile(null);
    setPreview(null);
    setChoices({});
    setLabelIds([]);
    setDedup("skip");
    setResult(null);
    setError(null);
  }

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 0.5 }}>Assistente de Importação</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Importe contatos de arquivos CSV, XLSX ou JSON. Relacione as colunas com campos existentes ou
        crie campos personalizados, e marque todos os registros com um ou mais rótulos.
      </Typography>

      <Stepper activeStep={activeStep} sx={{ mb: 3 }}>
        {STEPS.map((label) => (
          <Step key={label}><StepLabel>{label}</StepLabel></Step>
        ))}
      </Stepper>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

      {/* Etapa 1: arquivo + tipo */}
      {activeStep === 0 && (
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Stack spacing={2}>
            <ToggleButtonGroup
              exclusive
              size="small"
              value={contactType}
              onChange={(_e, v) => v && setContactType(v as "pessoa" | "empresa")}
            >
              <ToggleButton value="pessoa">Pessoas</ToggleButton>
              <ToggleButton value="empresa">Empresas</ToggleButton>
            </ToggleButtonGroup>

            <Box>
              <Button variant="outlined" component="label" startIcon={<UploadFileIcon />}>
                Escolher arquivo
                <input
                  hidden
                  type="file"
                  accept=".csv,.xlsx,.json"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
              </Button>
              {file && <Typography variant="body2" sx={{ mt: 1 }}>{file.name}</Typography>}
            </Box>

            <Box>
              <Button
                variant="contained"
                disabled={!file || previewMut.isPending}
                onClick={() => file && previewMut.mutate(file)}
                startIcon={previewMut.isPending ? <CircularProgress size={16} /> : undefined}
              >
                Analisar arquivo
              </Button>
            </Box>
          </Stack>
        </Paper>
      )}

      {/* Etapa 2: mapeamento */}
      {activeStep === 1 && preview && (
        <Box>
          <Alert severity="info" sx={{ mb: 2 }}>
            {preview.total_rows} linha(s) detectada(s). Relacione cada coluna do arquivo a um destino.
          </Alert>
          {!mappingValid && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              Faltam campos obrigatórios: {missingRequired.map((f) => STANDARD_LABELS[f]).join(", ")}.
            </Alert>
          )}
          <TableContainer component={Paper} variant="outlined" sx={{ mb: 2 }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Coluna do arquivo</TableCell>
                  <TableCell>Exemplo</TableCell>
                  <TableCell>Destino</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {preview.headers.map((h) => (
                  <MappingRow
                    key={h}
                    header={h}
                    sample={preview.sample[0]?.[h] ?? ""}
                    contactType={contactType}
                    customFields={preview.custom_fields}
                    choice={choices[h] ?? { kind: "ignore" }}
                    onChange={(c) => setChoices((prev) => ({ ...prev, [h]: c }))}
                  />
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          <Stack direction="row" spacing={1}>
            <Button onClick={() => setActiveStep(0)}>Voltar</Button>
            <Button variant="contained" disabled={!mappingValid} onClick={() => setActiveStep(2)}>
              Continuar
            </Button>
          </Stack>
        </Box>
      )}

      {/* Etapa 3: rótulos + duplicatas */}
      {activeStep === 2 && (
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Stack spacing={3}>
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>Rótulos para todos os registros</Typography>
              <Autocomplete
                multiple
                size="small"
                options={labels ?? []}
                getOptionLabel={(o) => o.name}
                value={(labels ?? []).filter((l) => labelIds.includes(l.id))}
                onChange={(_e, v) => setLabelIds(v.map((o) => o.id))}
                renderInput={(params) => <TextField {...textFieldParams(params)} placeholder="Selecione rótulos" />}
                renderTags={(value, getTagProps) =>
                  value.map((option, index) => (
                    <Chip label={option.name} size="small" {...getTagProps({ index })} key={option.id} />
                  ))
                }
              />
              <Typography variant="caption" color="text.secondary">
                Marketing e comercial usam esses rótulos para filtrar leads desta importação.
              </Typography>
            </Box>
            <Divider />
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>Se o contato já existir</Typography>
              <ToggleButtonGroup
                exclusive
                size="small"
                value={dedup}
                onChange={(_e, v) => v && setDedup(v as DuplicateStrategy)}
              >
                <ToggleButton value="skip">Ignorar (não alterar)</ToggleButton>
                <ToggleButton value="update">Atualizar dados</ToggleButton>
              </ToggleButtonGroup>
            </Box>
            <Stack direction="row" spacing={1}>
              <Button onClick={() => setActiveStep(1)}>Voltar</Button>
              <Button
                variant="contained"
                disabled={importMut.isPending}
                onClick={() => importMut.mutate()}
                startIcon={importMut.isPending ? <CircularProgress size={16} /> : undefined}
              >
                Importar {preview?.total_rows ?? 0} registro(s)
              </Button>
            </Stack>
          </Stack>
        </Paper>
      )}

      {/* Etapa 4: resultado */}
      {activeStep === 3 && result && (
        <Box>
          <Stack direction="row" spacing={2} sx={{ mb: 2 }} flexWrap="wrap" useFlexGap>
            <SummaryCard label="Criados" value={result.created} color="success.main" icon={<CheckCircleIcon />} />
            <SummaryCard label="Atualizados" value={result.updated} color="info.main" icon={<CheckCircleIcon />} />
            <SummaryCard label="Ignorados" value={result.skipped} color="text.secondary" icon={<ErrorOutlineIcon />} />
            <SummaryCard label="Rejeitados" value={result.rejected.length} color="error.main" icon={<ErrorOutlineIcon />} />
          </Stack>

          {result.createdFields.length > 0 && (
            <Alert severity="info" sx={{ mb: 2 }}>
              Campos personalizados criados: {result.createdFields.map((f) => f.name).join(", ")}.
            </Alert>
          )}

          {result.rejected.length > 0 && (
            <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
              <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
                <Typography variant="subtitle2">Linhas rejeitadas</Typography>
                <Button size="small" startIcon={<DownloadIcon />} onClick={() => downloadRejectedReport(result.rejected)}>
                  Baixar relatório
                </Button>
              </Stack>
              <TableContainer sx={{ maxHeight: 300 }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell>Linha</TableCell>
                      <TableCell>Motivo</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {result.rejected.slice(0, 200).map((r) => (
                      <TableRow key={r.line}>
                        <TableCell>{r.line}</TableCell>
                        <TableCell>{r.reason}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Paper>
          )}

          <Button variant="contained" onClick={reset}>Nova importação</Button>
        </Box>
      )}
    </Box>
  );
}

/** Cartão de resumo de uma métrica do resultado. */
function SummaryCard(props: { label: string; value: number; color: string; icon: JSX.Element }): JSX.Element {
  return (
    <Card variant="outlined" sx={{ minWidth: 140 }}>
      <CardContent>
        <Stack direction="row" spacing={1} alignItems="center">
          <Box sx={{ color: props.color, display: "flex" }}>{props.icon}</Box>
          <Box>
            <Typography variant="h5">{props.value}</Typography>
            <Typography variant="caption" color="text.secondary">{props.label}</Typography>
          </Box>
        </Stack>
      </CardContent>
    </Card>
  );
}

/** Linha da tabela de mapeamento de uma coluna. */
function MappingRow(props: {
  header: string;
  sample: string;
  contactType: "pessoa" | "empresa";
  customFields: ImportPreview["custom_fields"];
  choice: MappingChoice;
  onChange: (c: MappingChoice) => void;
}): JSX.Element {
  const { header, sample, contactType, customFields, choice, onChange } = props;

  // Valor selecionado no dropdown, codificado como string.
  const value = encodeChoice(choice);

  return (
    <TableRow>
      <TableCell>{header}</TableCell>
      <TableCell>
        <Tooltip title={sample}>
          <Typography variant="body2" noWrap sx={{ maxWidth: 200 }} color="text.secondary">
            {sample || "—"}
          </Typography>
        </Tooltip>
      </TableCell>
      <TableCell>
        <Stack direction="row" spacing={1} alignItems="center">
          <TextField
            select
            size="small"
            value={value}
            onChange={(e) => onChange(decodeChoice(e.target.value, choice))}
            sx={{ minWidth: 240 }}
          >
            <MenuItem value="ignore">Ignorar coluna</MenuItem>
            {FIELDS_BY_TYPE[contactType].map((f) => (
              <MenuItem key={f} value={`standard:${f}`}>{STANDARD_LABELS[f]}</MenuItem>
            ))}
            {customFields.map((cf) => (
              <MenuItem key={cf.id} value={`custom:${cf.id}`}>Campo: {cf.name}</MenuItem>
            ))}
            <MenuItem value="custom_new">➕ Criar novo campo personalizado</MenuItem>
          </TextField>

          {choice.kind === "custom_new" && (
            <>
              <TextField
                size="small"
                label="Nome do campo"
                value={choice.name}
                onChange={(e) => onChange({ kind: "custom_new", name: e.target.value, dataType: choice.dataType })}
                sx={{ width: 180 }}
              />
              <TextField
                select
                size="small"
                label="Tipo"
                value={choice.dataType}
                onChange={(e) =>
                  onChange({ kind: "custom_new", name: choice.name, dataType: e.target.value as CustomFieldDataType })
                }
                sx={{ width: 120 }}
              >
                <MenuItem value="text">Texto</MenuItem>
                <MenuItem value="number">Número</MenuItem>
                <MenuItem value="boolean">Sim/Não</MenuItem>
                <MenuItem value="date">Data</MenuItem>
              </TextField>
            </>
          )}
        </Stack>
      </TableCell>
    </TableRow>
  );
}

/** Codifica uma escolha de mapeamento em string para o `<Select>`. */
function encodeChoice(choice: MappingChoice): string {
  switch (choice.kind) {
    case "standard":
      return `standard:${choice.field}`;
    case "custom_existing":
      return `custom:${choice.fieldId}`;
    case "custom_new":
      return "custom_new";
    default:
      return "ignore";
  }
}

/** Decodifica o valor do `<Select>` em uma escolha de mapeamento. */
function decodeChoice(value: string, prev: MappingChoice): MappingChoice {
  if (value === "ignore") return { kind: "ignore" };
  if (value === "custom_new") {
    return prev.kind === "custom_new" ? prev : { kind: "custom_new", name: "", dataType: "text" };
  }
  if (value.startsWith("standard:")) {
    return { kind: "standard", field: value.slice("standard:".length) as StandardField };
  }
  if (value.startsWith("custom:")) {
    return { kind: "custom_existing", fieldId: value.slice("custom:".length) };
  }
  return { kind: "ignore" };
}
