-- Canais de comunicação por usuário e telefonia (ramal) — Req comunicação.
--
-- 1) core.users.extension: ramal do usuário no PABX remoto. O sistema envia um
--    curl (configurável) para o PABX informando o ramal que deve originar/retornar
--    a chamada solicitada a partir do cadastro de contatos.
-- 2) core.user_channels: credenciais do canal de WhatsApp por usuário via
--    Evolution API. Cada usuário conecta sua própria instância; o superadministrador
--    também pode inserir/editar as credenciais de qualquer usuário. Valores globais
--    de fallback (URL base/API key) ficam em core.settings (core.whatsapp.evolution.*).

ALTER TABLE core.users
  ADD COLUMN IF NOT EXISTS extension TEXT;                 -- ramal no PABX (opcional)

COMMENT ON COLUMN core.users.extension IS
  'Ramal do usuário no PABX remoto, usado na discagem via curl (variável {{ramal}}).';

CREATE TABLE IF NOT EXISTS core.user_channels (
  user_id            UUID PRIMARY KEY REFERENCES core.users (id) ON DELETE CASCADE,
  -- WhatsApp via Evolution API (por usuário)
  wa_evolution_url   TEXT,                                 -- URL base da Evolution API (NULL = usa global)
  wa_instance        TEXT,                                 -- nome da instância/sessão do usuário
  wa_api_key         TEXT,                                 -- API key/token da instância (NULL = usa global)
  wa_enabled         BOOLEAN NOT NULL DEFAULT false,       -- canal habilitado para o usuário
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by         UUID REFERENCES core.users (id)
);

COMMENT ON TABLE core.user_channels IS
  'Credenciais de canais de comunicação por usuário (WhatsApp/Evolution API). Fallback: core.settings core.whatsapp.evolution.*';
