-- Amplia mod_crm.leads com campos de negócio do pipeline/SLA (§4.1 do ModuloCRM).
-- Nenhuma coluna é dado de contato (que permanece na Base Central por referência).

ALTER TABLE mod_crm.leads
  ADD COLUMN source        VARCHAR(100),                  -- FK lógica mod_crm.lists (source)
  ADD COLUMN product       VARCHAR(100),                  -- FK lógica mod_crm.lists (product)
  ADD COLUMN partner       VARCHAR(100),                  -- FK lógica mod_crm.lists (partner)
  ADD COLUMN tags          TEXT[] NOT NULL DEFAULT '{}',  -- etiquetas do lead
  ADD COLUMN notes         TEXT,
  ADD COLUMN sla_deadline  TIMESTAMPTZ,                   -- vencimento do SLA da etapa atual
  ADD COLUMN sla_history   JSONB NOT NULL DEFAULT '{}',   -- memória { column_id: deadline }
  ADD COLUMN loss_reason   VARCHAR(200),                  -- motivo da perda
  ADD COLUMN discard_type  TEXT CHECK (discard_type IN ('soft', 'hard'));

COMMENT ON COLUMN mod_crm.leads.sla_history IS
  'Memória de SLA por etapa: mapa column_id -> deadline ISO. Restaura o prazo ao retornar (§5.2.3).';
