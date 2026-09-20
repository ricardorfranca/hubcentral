-- core.event_outbox — barramento de eventos durável (transactional outbox) (Req 12).
--
-- O produtor grava o evento na MESMA transação da mudança de dados. Um
-- despachante entrega aos assinantes e marca 'dispatched', garantindo entrega
-- ao menos uma vez sem depender de broker externo (adequado ao monólito modular).

CREATE TABLE core.event_outbox (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_name     TEXT NOT NULL,                              -- [modulo].[recurso].[acao] (Req 12.2)
  envelope       JSONB NOT NULL,                             -- EventEnvelope completo (Req 12.3)
  status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'dispatched')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  dispatched_at  TIMESTAMPTZ
);

-- O despachante busca pendentes na ordem de criação.
CREATE INDEX idx_event_outbox_pending ON core.event_outbox (created_at) WHERE status = 'pending';

COMMENT ON TABLE core.event_outbox IS
  'Transactional outbox de eventos. Publicação na mesma transação da mudança; despacho ao menos uma vez.';
