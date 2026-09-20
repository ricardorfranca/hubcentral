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
import { uploadLogo } from "../../core/api/branding.js";
import { useBrandingStore } from "../../core/branding/branding-store.js";

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

/** Converte bytes para MB (string com até 2 casas). */
function bytesToMb(bytes: string): string {
  const n = Number(bytes);
  return Number.isFinite(n) ? String(Math.round((n / (1024 * 1024)) * 100) / 100) : bytes;
}
/** Converte MB (string) para bytes inteiros. */
function mbToBytes(mb: string): string {
  const n = Number(mb);
  return Number.isFinite(n) ? String(Math.round(n * 1024 * 1024)) : mb;
}

/** Editor de um único parâmetro, conforme o tipo. */
function SettingEditor({ setting }: { setting: Setting }): JSX.Element {
  const qc = useQueryClient();
  // Parâmetros de tamanho em bytes são exibidos/editados em MB.
  const isBytes = setting.value_type === "int" && setting.key.endsWith("_bytes");
  const rawEffective = setting.value ?? setting.default_value ?? "";
  const effective = isBytes ? bytesToMb(rawEffective) : rawEffective;
  const [value, setValue] = useState<string>(effective);

  const save = useMutation({
    mutationFn: (v: string | null) => updateSetting(setting.key, v),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settings"] }),
  });

  const isBool = setting.value_type === "bool";
  const isColor = setting.key.endsWith("_color");
  const isLogo = setting.key === "core.branding.logo_url";
  const dirty = value !== effective;
  const setBranding = useBrandingStore((s) => s.setBranding);
  const persist = (v: string): void => {
    save.mutate(isBytes ? mbToBytes(v) : v);
    // Reflete branding imediatamente no tema.
    if (setting.key === "core.branding.primary_color") setBranding({ primaryColor: v });
    if (setting.key === "core.branding.secondary_color") setBranding({ secondaryColor: v });
    if (setting.key === "core.branding.system_name") setBranding({ systemName: v });
    if (isLogo) setBranding({ logoUrl: v || null });
  };

  async function onLogoFile(file: File): Promise<void> {
    const { logo_url } = await uploadLogo(file);
    setValue(logo_url);
    setBranding({ logoUrl: logo_url });
  }

  return (
    <Box>
      <Typography variant="subtitle2">{setting.label}{isBytes ? " (MB)" : ""}</Typography>
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
        ) : isColor ? (
          <>
            <input
              type="color"
              value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : "#000000"}
              onChange={(e) => setValue(e.target.value)}
              style={{ width: 48, height: 36, border: "none", background: "none", cursor: "pointer" }}
              aria-label={setting.label}
            />
            <TextField size="small" sx={{ width: 140 }} value={value} onChange={(e) => setValue(e.target.value)} />
            <Button variant="outlined" disabled={!dirty || save.isPending} onClick={() => persist(value)}>Salvar</Button>
          </>
        ) : (
          <>
            <TextField
              size="small"
              fullWidth
              type={setting.value_type === "int" ? "number" : "text"}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              helperText={setting.value_type === "csv" ? "Separe os valores por vírgula." : (isLogo ? "URL do logotipo, ou envie um arquivo." : undefined)}
            />
            {isLogo && (
              <Button variant="outlined" component="label">
                Enviar
                <input type="file" hidden accept="image/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) void onLogoFile(f); e.target.value = ""; }} />
              </Button>
            )}
            <Button
              variant="outlined"
              disabled={!dirty || save.isPending}
              onClick={() => persist(value)}
            >
              Salvar
            </Button>
          </>
        )}
      </Stack>
    </Box>
  );
}
