/**
 * @file SettingsPage.tsx
 * @module modules/admin
 *
 * Central de Configurações do HUB Central. Lista os parâmetros agrupados por
 * módulo; cada parâmetro é editado conforme seu tipo (número, booleano, texto,
 * lista/CSV). É o ponto único onde os módulos expõem seus ajustes.
 */

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Box, Typography, Card, CardContent, Stack, TextField, Button, Switch, FormControlLabel,
  CircularProgress, Divider,
} from "@mui/material";
import { listSettings, updateSetting, type Setting } from "../../core/api/settings.js";

/** Rótulos amigáveis por módulo. */
const MODULE_LABELS: Record<string, string> = {
  projetos: "Projetos Internos",
  crm: "CRM",
  core: "Núcleo",
};

/**
 * Página da Central de Configurações.
 *
 * @returns A tela de configurações.
 */
export function SettingsPage(): JSX.Element {
  const { data: settings, isLoading } = useQuery({ queryKey: ["settings"], queryFn: () => listSettings() });

  // Agrupa por módulo.
  const groups = useMemo(() => {
    const map = new Map<string, Setting[]>();
    for (const s of settings ?? []) {
      if (!map.has(s.module)) map.set(s.module, []);
      map.get(s.module)!.push(s);
    }
    return [...map.entries()];
  }, [settings]);

  if (isLoading) {
    return <Box sx={{ display: "grid", placeItems: "center", height: 200 }}><CircularProgress /></Box>;
  }

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 2 }}>Configurações do sistema</Typography>
      {groups.length === 0 && <Typography color="text.secondary">Nenhum parâmetro configurável.</Typography>}
      <Stack spacing={2}>
        {groups.map(([module, items]) => (
          <Card key={module} variant="outlined">
            <CardContent>
              <Typography variant="h6" gutterBottom>{MODULE_LABELS[module] ?? module}</Typography>
              <Divider sx={{ mb: 2 }} />
              <Stack spacing={2}>
                {items.map((s) => <SettingEditor key={s.key} setting={s} />)}
              </Stack>
            </CardContent>
          </Card>
        ))}
      </Stack>
    </Box>
  );
}

/** Editor de um único parâmetro, conforme o tipo. */
function SettingEditor({ setting }: { setting: Setting }): JSX.Element {
  const qc = useQueryClient();
  const effective = setting.value ?? setting.default_value ?? "";
  const [value, setValue] = useState<string>(effective);

  const save = useMutation({
    mutationFn: (v: string | null) => updateSetting(setting.key, v),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settings"] }),
  });

  const isBool = setting.value_type === "bool";
  const dirty = value !== effective;

  return (
    <Box>
      <Typography variant="subtitle2">{setting.label}</Typography>
      {setting.description && (
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
          {setting.description}
        </Typography>
      )}
      <Stack direction="row" spacing={1} alignItems="center">
        {isBool ? (
          <FormControlLabel
            control={
              <Switch
                checked={value === "true"}
                onChange={(e) => {
                  const v = e.target.checked ? "true" : "false";
                  setValue(v);
                  save.mutate(v);
                }}
              />
            }
            label={value === "true" ? "Ativado" : "Desativado"}
          />
        ) : (
          <>
            <TextField
              size="small"
              fullWidth
              type={setting.value_type === "int" ? "number" : "text"}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              helperText={setting.value_type === "csv" ? "Separe os valores por vírgula." : undefined}
            />
            <Button
              variant="outlined"
              disabled={!dirty || save.isPending}
              onClick={() => save.mutate(value)}
            >
              Salvar
            </Button>
          </>
        )}
      </Stack>
    </Box>
  );
}
