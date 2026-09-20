-- Campos personalizados — modelo híbrido (Req 4).
--
-- Definição relacional tipada (custom_field_defs) + valores em JSONB tipados
-- pela definição (contact_custom_field_values). Escolha do design sobre EAV
-- puro: mantém tipagem forte, permite índice GIN para filtragem e evita
-- explosão de linhas. Ex.: "escola_dos_filhos", "hobby_preferido".

CREATE TABLE core.custom_field_defs (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       CITEXT NOT NULL UNIQUE,                          -- nome único (Req 4.1)
  data_type  TEXT NOT NULL CHECK (data_type IN ('text', 'number', 'boolean', 'date')), -- Req 4.1
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE core.contact_custom_field_values (
  contact_id UUID NOT NULL REFERENCES core.contacts (id) ON DELETE CASCADE,
  field_id   UUID NOT NULL REFERENCES core.custom_field_defs (id) ON DELETE CASCADE,
  value      JSONB NOT NULL,                                  -- valor tipado (Req 4.2)
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (contact_id, field_id)                          -- um valor por campo por contato
);

-- Filtragem por valor de campo personalizado (Req 4.5).
CREATE INDEX idx_ccfv_value ON core.contact_custom_field_values USING GIN (value);
CREATE INDEX idx_ccfv_field ON core.contact_custom_field_values (field_id);

COMMENT ON TABLE core.custom_field_defs IS
  'Definições tipadas de campos personalizados (modelo híbrido). Valores em core.contact_custom_field_values.';
