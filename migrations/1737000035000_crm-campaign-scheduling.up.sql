-- Agendamento e throttling de campanhas (Req campanhas). Permite disparo
-- automático após o cadastro, controlando volume por lote e por hora.

ALTER TABLE mod_crm.campaigns
  ADD COLUMN IF NOT EXISTS auto_dispatch      BOOLEAN NOT NULL DEFAULT false, -- dispara sozinha após cadastro
  ADD COLUMN IF NOT EXISTS scheduled_at       TIMESTAMPTZ,                    -- quando começar (NULL = imediato)
  ADD COLUMN IF NOT EXISTS batch_size         INTEGER NOT NULL DEFAULT 50,    -- mensagens por vez (por ciclo)
  ADD COLUMN IF NOT EXISTS per_hour           INTEGER,                        -- teto de mensagens por hora (NULL = sem teto)
  ADD COLUMN IF NOT EXISTS dispatch_status    TEXT NOT NULL DEFAULT 'idle'
    CHECK (dispatch_status IN ('idle', 'queued', 'running', 'done', 'error')),
  ADD COLUMN IF NOT EXISTS sent_count         INTEGER NOT NULL DEFAULT 0,     -- total já enviado nesta execução
  ADD COLUMN IF NOT EXISTS window_started_at  TIMESTAMPTZ,                    -- início da janela de 1h corrente
  ADD COLUMN IF NOT EXISTS window_sent_count  INTEGER NOT NULL DEFAULT 0,     -- enviados na janela corrente
  ADD COLUMN IF NOT EXISTS last_dispatched_at TIMESTAMPTZ;                    -- último ciclo de envio

-- Fila de destinatários por campanha (público resolvido no agendamento).
CREATE TABLE IF NOT EXISTS mod_crm.campaign_recipients (
  campaign_id UUID NOT NULL REFERENCES mod_crm.campaigns (id) ON DELETE CASCADE,
  contact_id  UUID NOT NULL REFERENCES core.contacts (id) ON DELETE CASCADE,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  sent_at     TIMESTAMPTZ,
  error       TEXT,
  PRIMARY KEY (campaign_id, contact_id)
);

CREATE INDEX IF NOT EXISTS idx_campaign_recipients_pending
  ON mod_crm.campaign_recipients (campaign_id) WHERE status = 'pending';

COMMENT ON TABLE mod_crm.campaign_recipients IS
  'Fila de destinatários de uma campanha agendada; consumida pelo worker respeitando batch_size/per_hour.';
