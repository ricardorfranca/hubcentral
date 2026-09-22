/**
 * @file CustomFieldsEditor.tsx
 * @module core/ui
 *
 * Editor reutilizável dos valores de campos personalizados de um registro. Suporta
 * duas fontes de dados:
 *  - Contatos (`entity="contact"`): usa as rotas dedicadas de contato.
 *  - Entidades genéricas (`crm_opportunity`, `projetos_task`, ...): usa as rotas
 *    `/api/entities/:entity/:id/custom-fields`.
 *
 * Lista todas as definições da entidade e permite atribuir/limpar valores
 * conforme o tipo (texto, número, sim/não, data). É o ponto único de UI para
 * exibir e editar campos personalizados em qualquer módulo.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Stack, Typography, TextField, Switch, FormControlLabel, IconButton, Tooltip, CircularProgress,
} from "@mui/material";
import DeleteIcon from "@mui/icons-material/Delete";
import {
  listCustomFieldDefs, listContactCustomFields, setContactCustomField, clearContactCustomField,
  listEntityCustomFields, setEntityCustomField, clearEntityCustomField,
  type CustomFieldDataType, type CustomFieldEntity, type CustomFieldValue,
} from "../api/contacts.js";
import { ApiError } from "../api/client.js";

/** Retorno de feedback para o componente hospedeiro. */
export interface FieldFeedback {
  ok: boolean;
  text: string;
}

/** Props do editor: entidade + id do registro + callback de feedback. */
interface Props {
  entity: CustomFieldEntity;
  entityId: string;
  onFeedback?: (f: FieldFeedback) => void;
}

/** Nome amigável da entidade para a mensagem de "nenhum campo". */
const ENTITY_ADMIN_HINT = "Administração → Campos personalizados";

/**
 * Editor dos valores de campos personalizados de um registro (contato,
 * oportunidade, tarefa, ...).
 *
 * @param props - Entidade, id do registro e callback de feedback.
 * @returns O editor de campos personalizados.
 */
export function CustomFieldsEditor({ entity, entityId, onFeedback }: Props): JSX.Element {
  const qc = useQueryClient();
  const isContact = entity === "contact";

  // Definições da entidade (para a mensagem de vazio e a ordem de exibição).
  const { data: defs } = useQuery({
    queryKey: ["custom-fields", entity],
    queryFn: () => listCustomFieldDefs(entity),
  });

  // Valores do registro. Para contato, a rota retorna só valores atribuídos; para
  // entidades genéricas, retorna um item por definição (value possivelmente null).
  const valuesKey = ["custom-field-values", entity, entityId] as const;
  const { data: values, isLoading } = useQuery({
    queryKey: valuesKey,
    queryFn: () => (isContact ? listContactCustomFields(entityId) : listEntityCustomFields(entity, entityId)),
    enabled: Boolean(entityId),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: valuesKey });
  const feedback = (f: FieldFeedback) => onFeedback?.(f);

  const save = useMutation({
    mutationFn: ({ fieldId, value }: { fieldId: string; value: unknown }) =>
      isContact ? setContactCustomField(entityId, fieldId, value) : setEntityCustomField(entity, entityId, fieldId, value),
    onSuccess: () => { invalidate(); feedback({ ok: true, text: "Campo salvo." }); },
    onError: (e) => feedback({ ok: false, text: e instanceof ApiError ? e.message : "Falha ao salvar campo." }),
  });
  const clear = useMutation({
    mutationFn: (fieldId: string) =>
      isContact ? clearContactCustomField(entityId, fieldId) : clearEntityCustomField(entity, entityId, fieldId),
    onSuccess: () => { invalidate(); feedback({ ok: true, text: "Campo removido." }); },
  });

  if (isLoading) return <CircularProgress size={20} />;
  if ((defs ?? []).length === 0) {
    return <Typography variant="caption" color="text.secondary">Nenhum campo cadastrado. Crie em {ENTITY_ADMIN_HINT}.</Typography>;
  }

  const valueByField = new Map((values ?? []).map((v: CustomFieldValue) => [v.field_id, v.value]));

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
