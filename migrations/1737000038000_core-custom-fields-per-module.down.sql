-- Reverte campos personalizados por módulo/entidade.

DROP TABLE IF EXISTS core.entity_custom_field_values;

DROP INDEX IF EXISTS core.idx_custom_field_defs_entity;
DROP INDEX IF EXISTS core.uq_custom_field_defs_entity_name;

ALTER TABLE core.custom_field_defs
  DROP COLUMN IF EXISTS entity;

-- Restaura a unicidade global do nome (CITEXT), como antes. Idempotente:
-- recria a constraint apenas se ela não existir (o nome auto-gerado pela
-- coluna UNIQUE original é custom_field_defs_name_key).
ALTER TABLE core.custom_field_defs
  DROP CONSTRAINT IF EXISTS custom_field_defs_name_key;
ALTER TABLE core.custom_field_defs
  ADD CONSTRAINT custom_field_defs_name_key UNIQUE (name);
