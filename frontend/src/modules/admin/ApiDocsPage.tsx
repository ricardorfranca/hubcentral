/**
 * @file ApiDocsPage.tsx
 * @module modules/admin
 *
 * Documentação da API externa do HUB Central, acessível de dentro do sistema
 * (mesma autenticação de login). Descreve autenticação por chave de API,
 * sintaxe dos endpoints e exemplos prontos — incluindo o envio de leads a partir
 * de uma landing page com dados de rastreamento em campos personalizados.
 *
 * O acesso é liberado a quem administra configurações; a gestão das chaves em si
 * é feita na tela "APIs externas" (superadmin).
 */

import { Box, Typography, Paper, Stack, Divider, Link, Alert } from "@mui/material";
import { Link as RouterLink } from "react-router-dom";

/** Bloco de código monoespaçado com quebra preservada. */
function Code({ children }: { children: string }): JSX.Element {
  return (
    <Box
      component="pre"
      sx={{
        m: 0, p: 1.5, borderRadius: 1, bgcolor: "action.hover", overflowX: "auto",
        fontFamily: "monospace", fontSize: 13, whiteSpace: "pre",
      }}
    >
      {children}
    </Box>
  );
}

/** Título de seção com divisor. */
function Section({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography variant="h6" gutterBottom>{title}</Typography>
      <Divider sx={{ mb: 1.5 }} />
      <Stack spacing={1.5}>{children}</Stack>
    </Paper>
  );
}

/** Base pública usada nos exemplos (o host real depende do deploy). */
const BASE = "https://SEU-HOST";

/**
 * Página de documentação da API externa.
 *
 * @returns A tela de documentação.
 */
export function ApiDocsPage(): JSX.Element {
  return (
    <Box sx={{ maxWidth: 900 }}>
      <Typography variant="h5" sx={{ mb: 0.5 }}>Documentação da API</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Referência para desenvolvedores integrarem sistemas externos ao HUB Central. As chaves de API são
        gerenciadas em <Link component={RouterLink} to="/admin/apis-externas">APIs externas</Link>.
      </Typography>

      <Stack spacing={2}>
        <Section title="Autenticação">
          <Typography variant="body2">
            Toda requisição à API externa exige uma chave de API válida, enviada em um destes cabeçalhos:
          </Typography>
          <Code>{`Authorization: Bearer <segredo-da-chave>
# ou
X-API-Key: <segredo-da-chave>`}</Code>
          <Typography variant="body2">
            Cada chave só pode executar as operações cujos <em>namespaces</em> lhe foram concedidos. Sem a
            permissão adequada, a API responde <code>403 RBAC_ACCESS_DENIED</code>.
          </Typography>
          <Alert severity="info">
            O segredo é exibido uma única vez, no momento da criação da chave. Guarde-o com segurança; se for
            perdido, gere uma nova chave.
          </Alert>
        </Section>

        <Section title="Formato de erros">
          <Typography variant="body2">Erros seguem sempre o formato:</Typography>
          <Code>{`{
  "code": "RBAC_ACCESS_DENIED",
  "message": "A chave de API não tem permissão para esta ação.",
  "details": { "required_namespace": "api:crm:ingest_lead" }
}`}</Code>
        </Section>

        <Section title="POST /api/external/crm/leads — Receber lead de landing page">
          <Typography variant="body2">
            Cria um lead no CRM a partir de dados enviados por uma landing page (ou outro sistema). Faz
            find-or-create dos contatos (pessoa por e-mail; empresa por documento fiscal) e grava dados de
            rastreamento como <strong>campos personalizados de contato</strong>, mapeados por nome.
          </Typography>
          <Typography variant="body2">
            Permissão exigida na chave: <code>api:crm:ingest_lead</code>. Para gravar rastreamento, crie antes
            os campos personalizados de <em>Contatos</em> em Administração → Campos personalizados (ex.:
            <code>utm_source</code>, <code>utm_campaign</code>, <code>landing_url</code>). Campos não cadastrados
            são ignorados e retornados em <code>ignored_fields</code>.
          </Typography>

          <Typography variant="subtitle2">Requisição</Typography>
          <Code>{`POST ${BASE}/api/external/crm/leads
Content-Type: application/json
Authorization: Bearer <segredo-da-chave>

{
  "person":  { "full_name": "Maria Silva", "email": "maria@exemplo.com", "phone": "+5511999998888" },
  "company": { "legal_name": "Exemplo LTDA", "fiscal_document": "12345678000199" },
  "tracking": {
    "utm_source":   "google",
    "utm_campaign": "black-friday",
    "landing_url":  "https://site.com/oferta"
  }
}`}</Code>

          <Typography variant="subtitle2">Resposta (201)</Typography>
          <Code>{`{
  "lead_id": "3f9c…",
  "person_contact_id": "7a11…",
  "applied_fields": ["utm_source", "utm_campaign", "landing_url"],
  "ignored_fields": []
}`}</Code>

          <Typography variant="subtitle2">Exemplo com curl</Typography>
          <Code>{`curl -X POST ${BASE}/api/external/crm/leads \\
  -H "Authorization: Bearer <segredo-da-chave>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "person": { "full_name": "Maria Silva", "email": "maria@exemplo.com", "phone": "+5511999998888" },
    "tracking": { "utm_source": "google", "utm_campaign": "black-friday" }
  }'`}</Code>

          <Typography variant="subtitle2">Exemplo em JavaScript (fetch)</Typography>
          <Code>{`await fetch("${BASE}/api/external/crm/leads", {
  method: "POST",
  headers: {
    "Authorization": "Bearer <segredo-da-chave>",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    person: { full_name: "Maria Silva", email: "maria@exemplo.com", phone: "+5511999998888" },
    tracking: { utm_source: "google", utm_campaign: "black-friday", landing_url: location.href },
  }),
});`}</Code>
        </Section>

        <Section title="Campos personalizados de rastreamento">
          <Typography variant="body2">
            Os dados de <code>tracking</code> são gravados no contato (pessoa) usando os campos personalizados
            da entidade <em>Contatos</em>. Assim, informações como origem da campanha e URL de captura ficam
            disponíveis nas telas de contato e podem ser usadas em segmentações e relatórios do CRM.
          </Typography>
        </Section>
      </Stack>
    </Box>
  );
}
