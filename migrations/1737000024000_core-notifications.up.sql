-- core.notifications — Central de Notificações in-app do HUB Central.
--
-- Serviço genérico do núcleo, reutilizável por qualquer módulo. Um produtor
-- (via assinante do outbox) grava uma notificação para um destinatário. O
-- campo `module` permite filtrar por origem; `link` guarda a rota do SPA para
-- navegação ao clicar. `source_event_id` deduplica em reprocessamento do outbox.

CREATE TABLE core.notifications (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_user_id UUID NOT NULL REFERENCES core.users (id) ON DELETE CASCADE,
  module            TEXT NOT NULL,                    -- crm|projetos|core
  type              TEXT NOT NULL,                    -- ex.: projetos.tarefa.movida
  message           TEXT NOT NULL,
  entity_type       TEXT,                             -- ex.: task|project
  entity_id         UUID,                             -- referência da entidade de origem
  link              TEXT,                             -- rota do frontend p/ abrir a entidade
  read              BOOLEAN NOT NULL DEFAULT false,
  source_event_id   UUID,                             -- event_id de origem (dedupe)
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at           TIMESTAMPTZ
);

-- Lista/contagem de não lidas por usuário.
CREATE INDEX idx_notifications_recipient ON core.notifications (recipient_user_id, read);

-- Dedupe idempotente: um mesmo evento não gera notificação repetida ao mesmo destinatário.
CREATE UNIQUE INDEX uq_notifications_event_recipient
  ON core.notifications (source_event_id, recipient_user_id)
  WHERE source_event_id IS NOT NULL;

COMMENT ON TABLE core.notifications IS
  'Central de Notificações in-app do núcleo; reutilizável por qualquer módulo.';
