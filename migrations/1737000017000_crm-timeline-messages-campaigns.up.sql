-- Timeline do lead, mensageria interna e campanhas (§4.2, §4.3, §4.4 do ModuloCRM).

-- Registro imutável de ações sobre um lead (§4.2).
CREATE TABLE mod_crm.lead_timeline (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id     UUID NOT NULL REFERENCES mod_crm.leads (id) ON DELETE CASCADE,
  user_id     UUID REFERENCES core.users (id),        -- NULL = SYSTEM
  user_name   VARCHAR(200),                            -- snapshot do autor
  action_type TEXT NOT NULL CHECK (action_type IN ('stage', 'note', 'status', 'info', 'success', 'error')),
  text        TEXT NOT NULL,
  "timestamp" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_crm_timeline_lead ON mod_crm.lead_timeline (lead_id, "timestamp");

-- Mensageria interna: canal de equipe (group) e DMs (§4.4, §9).
CREATE TABLE mod_crm.messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_user_id    UUID REFERENCES core.users (id),     -- NULL = Sistema
  from_user_name  VARCHAR(200),                         -- snapshot
  conversation_id VARCHAR(100) NOT NULL,                -- 'group' ou dm_{min}_{max}
  text            TEXT NOT NULL,
  type            TEXT NOT NULL DEFAULT 'message' CHECK (type IN ('message', 'sla_alert', 'system')),
  lead_id         UUID REFERENCES mod_crm.leads (id),   -- opcional (alerta vinculado)
  "timestamp"     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_crm_messages_conversation ON mod_crm.messages (conversation_id, "timestamp");

-- Campanhas de marketing (§4.3, §6).
CREATE TABLE mod_crm.campaigns (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       VARCHAR(200) NOT NULL,
  tags       TEXT[] NOT NULL DEFAULT '{}',              -- etiquetas alvo
  channels   TEXT[] NOT NULL DEFAULT '{}',              -- email/whatsapp/sms
  status     TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused')),
  subject    TEXT,
  body_type  TEXT NOT NULL DEFAULT 'text' CHECK (body_type IN ('text', 'html')),
  body_text  TEXT,
  body_html  TEXT,
  created_by UUID REFERENCES core.users (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE mod_crm.lead_timeline IS 'Histórico imutável (append-only) de ações do lead.';
COMMENT ON TABLE mod_crm.messages IS 'Mensageria interna: canal group e DMs dm_{min}_{max}.';
COMMENT ON TABLE mod_crm.campaigns IS 'Campanhas segmentadas por etiquetas; corpo text/html independentes.';
