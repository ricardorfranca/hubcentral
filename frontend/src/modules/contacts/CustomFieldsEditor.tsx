/**
 * @file CustomFieldsEditor.tsx
 * @module modules/contacts
 *
 * Editor dos valores de campos personalizados de um contato (pessoa ou
 * empresa). Extraído da página de contatos para ser reutilizado tanto pelo
 * diálogo de pessoa quanto pelo diálogo de empresa.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Stack, Typography, TextField, Switch, FormControlLabel, IconButton, Tooltip, CircularProgress,
} from "@mui/material";
import DeleteIcon from "@mui/icons-material/Delete";
import {
  listCustomFieldDefs, listContactCustomFields, setContactCustomField, clearContactCustomField,
  type CustomFieldDataType,
} from "../../core/api/contacts.js";
import { ApiError } from "../../core/api/client.js";

/** Retorno de feedback para o diálogo hospedeiro. */
export interface FieldFeedback {
  ok: boolean;
  text: string;
}

/**
 * Editor dos valores de campos personalizados de um contato. Lista todas as
 * definições e permite atribuir/limpar valores conforme o tipo.
 *
 * @param props - `contactId` do contato e callback de feedback.
 * @returns O editor de campos personalizados.
 */
export function CustomFieldsEditor({
  contactId, onFeedback,
}: {
  contactId: string; onFeedback: (f: FieldFeedback) => void;
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
