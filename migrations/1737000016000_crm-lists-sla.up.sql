-- Listas configuráveis e configuração de SLA do CRM (§7.8, §5.2 do ModuloCRM).

-- Listas que alimentam dropdowns: etiquetas, origens, produtos, parceiros, motivos.
CREATE TABLE mod_crm.lists (
  id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type   TEXT NOT NULL CHECK (type IN ('tag', 'source', 'product', 'partner', 'loss_reason')),
  value  VARCHAR(200) NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT uq_crm_list_value UNIQUE (type, value)
);

CREATE INDEX idx_crm_lists_type ON mod_crm.lists (type) WHERE active = true;

-- SLA por etapa do pipeline (§5.2, §7.9).
CREATE TABLE mod_crm.sla_config (
  column_id  VARCHAR(50) PRIMARY KEY,
  value      INTEGER NOT NULL CHECK (value > 0),
  unit       TEXT NOT NULL CHECK (unit IN ('minutes', 'hours', 'days')),
  updated_by UUID REFERENCES core.users (id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed dos SLAs padrão das etapas ativas (§5.1).
INSERT INTO mod_crm.sla_config (column_id, value, unit) VALUES
  ('ligacao',  30, 'minutes'),
  ('proposta', 30, 'minutes'),
  ('reuniao',   7, 'days');

COMMENT ON TABLE mod_crm.lists IS 'Listas configuráveis do CRM (tag, source, product, partner, loss_reason).';
COMMENT ON TABLE mod_crm.sla_config IS 'SLA por etapa do pipeline. value+unit definem o prazo.';
