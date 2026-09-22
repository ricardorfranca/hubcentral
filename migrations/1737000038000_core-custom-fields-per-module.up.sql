-- Campos personalizados por módulo/entidade.
--
-- Extensão do modelo híbrido de campos personalizados (antes exclusivo de
-- contatos) para qualquer entidade do sistema (ex.: oportunidades do CRM,
-- tarefas de Projetos). Duas mudanças:
--
--   1. core.custom_field_defs ganha a coluna `entity` — a qual entidade o campo
--      pertence (ex.: 'contact', 'crm_opportunity', 'projetos_task'). Os campos
--      existentes são de contato, então recebem 'contact' no backfill. A
--      unicidade do nome passa a ser POR entidade (dois módulos podem ter um
--      campo "origem" sem conflito).
--
--   2. Nova tabela genérica core.entity_custom_field_values guarda os valores
--      de campos personalizados de entidades que NÃO são contato. Contatos
--      continuam usando core.contact_custom_field_values (com FK forte para
--      core.contacts e cascata), preservando import/export e campanhas.

-- 1) Escopo por entidade nas definições.
ALTER TABLE core.custom_field_defs
  ADD COLUMN entity TEXT NOT NULL DEFAULT 'contact';

-- Nome único por entidade (não mais global). Remove o UNIQUE global do CITEXT.
ALTER TABLE core.custom_field_defs
  DROP CONSTRAINT IF EXISTS custom_field_defs_name_key;

CREATE UNIQUE INDEX uq_custom_field_defs_entity_name
  ON core.custom_field_defs (entity, name);

CREATE INDEX idx_custom_field_defs_entity
  ON core.custom_field_defs (entity);

COMMENT ON COLUMN core.custom_field_defs.entity IS
  'Entidade dona do campo (ex.: contact, crm_opportunity, projetos_task). O nome é único por entidade.';

-- 2) Valores genéricos (para entidades que não são contato).
--
-- Não há FK para a entidade alvo (ela vive em schemas diferentes: mod_crm,
-- mod_projetos). A integridade referencial é responsabilidade da aplicação, que
-- valida a existência da entidade antes de gravar o valor. `entity_id` é UUID
-- para casar com as PKs UUID de todo o sistema.
CREATE TABLE core.entity_custom_field_values (
  entity     TEXT NOT NULL,
  entity_id  UUID NOT NULL,
  field_id   UUID NOT NULL REFERENCES core.custom_field_defs (id) ON DELETE CASCADE,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (entity, entity_id, field_id)
);

-- Filtragem por valor de campo personalizado.
CREATE INDEX idx_ecfv_value ON core.entity_custom_field_values USING GIN (value);
CREATE INDEX idx_ecfv_field ON core.entity_custom_field_values (field_id);
CREATE INDEX idx_ecfv_entity ON core.entity_custom_field_values (entity, entity_id);

COMMENT ON TABLE core.entity_custom_field_values IS
  'Valores de campos personalizados de entidades genéricas (não-contato). Contatos usam core.contact_custom_field_values.';
