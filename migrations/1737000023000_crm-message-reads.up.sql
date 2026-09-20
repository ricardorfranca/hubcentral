-- CRM 2.0 — estado de leitura de conversas por usuário, para contagem de não
-- lidas na mensageria interna.

CREATE TABLE mod_crm.message_reads (
  user_id         UUID NOT NULL REFERENCES core.users (id) ON DELETE CASCADE,
  conversation_id VARCHAR(100) NOT NULL,
  last_read_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, conversation_id)
);

COMMENT ON TABLE mod_crm.message_reads IS
  'Marca a última leitura de cada conversa por usuário (para não lidas).';
