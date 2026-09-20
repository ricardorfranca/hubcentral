-- Tabela central de auditoria imutável do HUB Central (§5 da arquitetura, Req 13).
--
-- Esta migration cria a ESTRUTURA da tabela. O reforço de imutabilidade
-- (REVOKE UPDATE/DELETE + trigger BEFORE UPDATE OR DELETE) é aplicado pela
-- Tarefa 9 do plano de implementação (Req 13.4), pois depende da role de
-- aplicação já existir.

CREATE TABLE core.system_logs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "timestamp"    TIMESTAMPTZ NOT NULL DEFAULT now(),  -- gravado em UTC (Req 13.3)
  user_id        UUID REFERENCES core.users (id),     -- NULL representa ator SYSTEM
  module         TEXT NOT NULL,                        -- 'core' ou nome do módulo (Req 13.1)
  action         TEXT NOT NULL,                        -- ex.: 'CONTATO_CRIADO'
  payload_before JSONB,                                -- estado anterior (Req 13.3)
  payload_after  JSONB,                                -- estado novo (Req 13.3)
  ip_address     TEXT,
  user_agent     TEXT
);

CREATE INDEX idx_system_logs_module ON core.system_logs (module);
CREATE INDEX idx_system_logs_timestamp ON core.system_logs ("timestamp");
CREATE INDEX idx_system_logs_user ON core.system_logs (user_id);

COMMENT ON TABLE core.system_logs IS
  'Log de auditoria imutável (append-only). Única porta de escrita é o AuditLogger. Imutabilidade reforçada na Tarefa 9.';
