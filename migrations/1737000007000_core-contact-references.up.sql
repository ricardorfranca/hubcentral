-- core.contact_references — registro de referências de módulo a contatos (Req 7).
--
-- Cada vez que um módulo satélite associa um registro a um contato, registra
-- aqui uma Referencia_Contato. Isso permite:
--   * listar os módulos que referenciam um contato (Req 7.5);
--   * bloquear a exclusão de um contato com referências ativas, sem varrer
--     todos os schemas mod_* (Req 7.5).
--
-- ON DELETE RESTRICT reforça no banco a proteção contra exclusão de contato
-- referenciado (Req 7.4/7.5): a linha em contacts não pode ser removida
-- enquanto houver referência apontando para ela.

CREATE TABLE core.contact_references (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module     TEXT NOT NULL,                                  -- ex.: 'mod_crm'
  table_name TEXT NOT NULL,                                  -- ex.: 'leads'
  contact_id UUID NOT NULL REFERENCES core.contacts (id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Idempotência do registro de referência (Req 7.1).
  CONSTRAINT uq_contact_reference UNIQUE (module, table_name, contact_id)
);

CREATE INDEX idx_contact_references_contact ON core.contact_references (contact_id);

COMMENT ON TABLE core.contact_references IS
  'Referências de módulos a contatos. Permite listar módulos e bloquear exclusão sem varrer schemas mod_*.';
