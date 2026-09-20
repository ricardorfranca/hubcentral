-- core.contact_categories e core.contact_category_assignments (Req 3).
--
-- Categorias classificam contatos (lead frio, cliente/fornecedor ativo/inativo,
-- ou categorias de livre criação). is_system marca as 5 categorias imutáveis
-- de sistema. name é CITEXT UNIQUE => unicidade case-insensitive (Req 3.5).

CREATE TABLE core.contact_categories (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       CITEXT NOT NULL UNIQUE,               -- unicidade case-insensitive (Req 3.5)
  is_system  BOOLEAN NOT NULL DEFAULT false,        -- true = categoria de sistema (Req 3.1)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Associação N:N contato↔categoria (Req 3.2).
CREATE TABLE core.contact_category_assignments (
  contact_id  UUID NOT NULL REFERENCES core.contacts (id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES core.contact_categories (id) ON DELETE RESTRICT,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (contact_id, category_id)
);

CREATE INDEX idx_cca_category ON core.contact_category_assignments (category_id);

-- Seed das 5 categorias de sistema (Req 3.1). Nomes estáveis usados também
-- como identificadores de negócio.
INSERT INTO core.contact_categories (name, is_system) VALUES
  ('lead_frio',         true),
  ('cliente_ativo',     true),
  ('cliente_inativo',   true),
  ('fornecedor_ativo',  true),
  ('fornecedor_inativo', true);

COMMENT ON TABLE core.contact_categories IS
  'Categorias de contato. 5 de sistema (is_system=true) + categorias customizadas. Nome único case-insensitive.';
