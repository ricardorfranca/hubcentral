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
  CircularProgress, Divider, Alert,
} from "@mui/material";
import { listSettings, updateSetting, testSmtp, testSms, type Setting } from "../../core/api/settings.js";
import { testMyChannel } from "../../core/api/comms.js";
import { uploadLogo } from "../../core/api/branding.js";
import { downloadBackup, restoreBackup } from "../../core/api/backup.js";
import { useBrandingStore } from "../../core/branding/branding-store.js";
import { useCan } from "../../core/rbac/can.js";

/** Rótulos amigáveis por módulo. */
const MODULE_LABELS: Record<string, string> = {
  projetos: "Projetos Internos",
  crm: "CRM",
  core: "Núcleo",
};

/**
 * Rótulos amigáveis por subgrupo (prefixo da chave `modulo.recurso`). Usado para
 * separar visualmente os parâmetros dentro de cada módulo e evitar confusão
 * entre áreas (identidade visual, e-mail, SMS, WhatsApp, telefonia, etc.).
 */
const SUBGROUP_LABELS: Record<string, string> = {
  "core.branding": "Identidade visual (white-label)",
  "core.smtp": "E-mail (SMTP)",
  "core.sms": "SMS (gateway)",
  "core.whatsapp": "WhatsApp (Evolution API)",
  "core.telephony": "Telefonia / PABX (discagem)",
  "core.uploads": "Uploads e anexos",
  "core.security": "Segurança",
};

/** Ordem de exibição dos subgrupos conhecidos (demais vão ao final, alfabético). */
const SUBGROUP_ORDER = [
  "core.branding",
  "core.smtp",
  "core.sms",
  "core.whatsapp",
  "core.telephony",
  "core.uploads",
  "core.security",
];

/** Deriva o prefixo de subgrupo `modulo.recurso` a partir da chave. */
function subgroupOf(key: string): string {
  const parts = key.split(".");
  return parts.length >= 2 ? `${parts[0]}.${parts[1]}` : parts[0] ?? key;
}

/** Rótulo amigável do subgrupo (fallback: capitaliza o recurso). */
function subgroupLabel(prefix: string): string {
  if (SUBGROUP_LABELS[prefix]) return SUBGROUP_LABELS[prefix];
  const resource = prefix.split(".")[1] ?? prefix;
  return resource.charAt(0).toUpperCase() + resource.slice(1);
}

/**
 * Página da Central de Configurações.
 *
 * @returns A tela de configurações.
 */
export function SettingsPage(): JSX.Element {
  const can = useCan();
  const { data: settings, isLoading } = useQuery({ queryKey: ["settings"], queryFn: () => listSettings() });

  // Agrupa por módulo e, dentro de cada módulo, por subgrupo temático (prefixo
  // `modulo.recurso`) para não misturar áreas distintas (e-mail, SMS, WhatsApp…).
  const groups = useMemo(() => {
    const byModule = new Map<string, Map<string, Setting[]>>();
    for (const s of settings ?? []) {
      if (!byModule.has(s.module)) byModule.set(s.module, new Map());
      const sub = byModule.get(s.module)!;
      const prefix = subgroupOf(s.key);
      if (!sub.has(prefix)) sub.set(prefix, []);
      sub.get(prefix)!.push(s);
    }
    // Ordena subgrupos pela ordem conhecida e, depois, alfabeticamente.
    return [...byModule.entries()].map(([module, sub]) => {
      const subgroups = [...sub.entries()].sort((a, b) => {
        const ia = SUBGROUP_ORDER.indexOf(a[0]);
        const ib = SUBGROUP_ORDER.indexOf(b[0]);
        if (ia !== -1 || ib !== -1) return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
        return a[0].localeCompare(b[0]);
      });
      return [module, subgroups] as const;
    });
  }, [settings]);

  if (isLoading) {
    return <Box sx={{ display: "grid", placeItems: "center", height: 200 }}><CircularProgress /></Box>;
  }

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 0.5 }}>Configurações do sistema</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Parâmetros agrupados por área. Cada seção reúne apenas as configurações do seu tema.
      </Typography>
      {groups.length === 0 && <Typography color="text.secondary">Nenhum parâmetro configurável.</Typography>}
      <Stack spacing={2}>
        {groups.map(([module, subgroups]) => (
          <Card key={module} variant="outlined">
            <CardContent>
              <Typography variant="h6" gutterBottom>{MODULE_LABELS[module] ?? module}</Typography>
              <Divider sx={{ mb: 2 }} />
              <Stack spacing={3}>
                {subgroups.map(([prefix, items]) => (
                  <Box key={prefix}>
                    {/* Só rotula o subgrupo quando há mais de um subgrupo no módulo. */}
                    {subgroups.length > 1 && (
                      <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
                        {subgroupLabel(prefix)}
                      </Typography>
                    )}
                    <Stack spacing={2}>
                      {items.map((s) => <SettingEditor key={s.key} setting={s} />)}
                    </Stack>
                    {prefix === "core.smtp" && <SmtpTestPanel />}
                    {prefix === "core.sms" && <SmsTestPanel />}
                    {prefix === "core.whatsapp" && <WhatsappTestPanel />}
                  </Box>
                ))}
              </Stack>
            </CardContent>
          </Card>
        ))}
        {can("core:backup:gerenciar") && <BackupPanel />}
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
  const isSecret = setting.key.endsWith(".password");
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
              type={isSecret ? "password" : setting.value_type === "int" ? "number" : "text"}
              {...(isSecret ? { autoComplete: "new-password" } : {})}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              helperText={setting.value_type === "csv" ? "Separe os valores por vírgula." : (isLogo ? "URL do logotipo, ou envie um arquivo." : "")}
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

/** Painel de teste de conexão SMTP (com envio opcional de e-mail de teste). */
function SmtpTestPanel(): JSX.Element {
  const [testTo, setTestTo] = useState("");
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const test = useMutation({
    mutationFn: () => testSmtp(testTo.trim() || undefined),
    onSuccess: (r) => setResult({ ok: true, msg: r.sent ? "Conexão OK e e-mail de teste enviado." : "Conexão SMTP verificada com sucesso." }),
    onError: (e) => setResult({ ok: false, msg: e instanceof Error ? e.message : "Falha no teste SMTP." }),
  });

  return (
    <Box sx={{ mt: 2 }}>
      <Divider sx={{ mb: 2 }} />
      <Typography variant="subtitle2" gutterBottom>Teste de conexão SMTP</Typography>
      {result && <Alert severity={result.ok ? "success" : "error"} sx={{ mb: 1 }} onClose={() => setResult(null)}>{result.msg}</Alert>}
      <Stack direction="row" spacing={1} alignItems="center">
        <TextField
          size="small"
          fullWidth
          type="email"
          label="Enviar e-mail de teste para (opcional)"
          value={testTo}
          onChange={(e) => setTestTo(e.target.value)}
        />
        <Button variant="outlined" onClick={() => test.mutate()} disabled={test.isPending}>
          {test.isPending ? "Testando…" : "Testar"}
        </Button>
      </Stack>
    </Box>
  );
}

/** Painel de backup/restore (somente superadmin com core:backup:gerenciar). */
function BackupPanel(): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  async function doBackup(): Promise<void> {
    setBusy(true);
    setResult(null);
    try {
      await downloadBackup();
      setResult({ ok: true, msg: "Backup gerado e baixado." });
    } catch (e) {
      setResult({ ok: false, msg: e instanceof Error ? e.message : "Falha ao gerar backup." });
    } finally {
      setBusy(false);
    }
  }

  async function doRestore(file: File): Promise<void> {
    if (confirm !== "RESTAURAR") {
      setResult({ ok: false, msg: 'Digite RESTAURAR para confirmar antes de selecionar o arquivo.' });
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      await restoreBackup(file);
      setResult({ ok: true, msg: "Restore concluído. Recarregue a página." });
    } catch (e) {
      setResult({ ok: false, msg: e instanceof Error ? e.message : "Falha ao restaurar." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="h6" gutterBottom>Backup e restauração</Typography>
        <Divider sx={{ mb: 2 }} />
        {result && <Alert severity={result.ok ? "success" : "error"} sx={{ mb: 2 }} onClose={() => setResult(null)}>{result.msg}</Alert>}

        <Stack spacing={2}>
          <Box>
            <Typography variant="subtitle2">Backup</Typography>
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
              Gera um pacote com o banco de dados e os anexos, e baixa no seu navegador.
            </Typography>
            <Button variant="contained" onClick={doBackup} disabled={busy}>
              {busy ? "Processando…" : "Gerar backup"}
            </Button>
          </Box>

          <Divider />

          <Box>
            <Typography variant="subtitle2" color="error">Restauração (destrutivo)</Typography>
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
              Substitui TODO o banco de dados e os anexos pelo conteúdo do pacote. Esta ação não pode ser desfeita.
              Digite <strong>RESTAURAR</strong> e selecione o arquivo de backup.
            </Typography>
            <Stack direction="row" spacing={1} alignItems="center">
              <TextField
                size="small"
                placeholder="Digite RESTAURAR"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
              <Button variant="outlined" color="error" component="label" disabled={busy || confirm !== "RESTAURAR"}>
                Selecionar backup e restaurar
                <input
                  type="file"
                  hidden
                  accept=".gz,.tar.gz,application/gzip"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void doRestore(f); e.target.value = ""; }}
                />
              </Button>
            </Stack>
          </Box>
        </Stack>
      </CardContent>
    </Card>
  );
}

/** Painel de teste do gateway de SMS (Clickatell/GoIP). */
function SmsTestPanel(): JSX.Element {
  const [testTo, setTestTo] = useState("");
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const test = useMutation({
    mutationFn: () => testSms(testTo.trim() || undefined),
    onSuccess: (r) => setResult({ ok: true, msg: r.sent ? `SMS de teste enviado via ${r.provider}.` : `Gateway ${r.provider} verificado.` }),
    onError: (e) => setResult({ ok: false, msg: e instanceof Error ? e.message : "Falha no teste de SMS." }),
  });

  return (
    <Box sx={{ mt: 2 }}>
      <Divider sx={{ mb: 2 }} />
      <Typography variant="subtitle2" gutterBottom>Teste de SMS</Typography>
      {result && <Alert severity={result.ok ? "success" : "error"} sx={{ mb: 1 }} onClose={() => setResult(null)}>{result.msg}</Alert>}
      <Stack direction="row" spacing={1} alignItems="center">
        <TextField
          size="small"
          fullWidth
          label="Enviar SMS de teste para (opcional, com DDD)"
          value={testTo}
          onChange={(e) => setTestTo(e.target.value)}
        />
        <Button variant="outlined" onClick={() => test.mutate()} disabled={test.isPending}>
          {test.isPending ? "Testando…" : "Testar"}
        </Button>
      </Stack>
    </Box>
  );
}

/**
 * Painel de teste do canal de WhatsApp (Evolution API). Verifica a conexão da
 * instância do usuário autenticado. Cada usuário configura suas credenciais em
 * "Meu canal de WhatsApp"; aqui ficam apenas os valores globais de fallback.
 */
function WhatsappTestPanel(): JSX.Element {
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const test = useMutation({
    mutationFn: () => testMyChannel(),
    onSuccess: (r) => setResult({ ok: true, msg: `Instância "${r.instance}" conectada.` }),
    onError: (e) => setResult({ ok: false, msg: e instanceof Error ? e.message : "Falha ao testar o canal de WhatsApp." }),
  });

  return (
    <Box sx={{ mt: 2 }}>
      <Divider sx={{ mb: 2 }} />
      <Typography variant="subtitle2" gutterBottom>Teste do canal de WhatsApp</Typography>
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
        Os valores acima são o padrão (fallback) global. Cada usuário define suas próprias credenciais
        em Usuários → canal de WhatsApp, ou o superadministrador pode inseri-las.
      </Typography>
      {result && <Alert severity={result.ok ? "success" : "error"} sx={{ mb: 1 }} onClose={() => setResult(null)}>{result.msg}</Alert>}
      <Button variant="outlined" onClick={() => test.mutate()} disabled={test.isPending}>
        {test.isPending ? "Testando…" : "Testar minha conexão"}
      </Button>
    </Box>
  );
}
