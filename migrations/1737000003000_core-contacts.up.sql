-- core.contacts — fonte única de verdade de contatos (Req 1, 5).
--
-- Tabela única com discriminador contact_type ('pessoa' | 'empresa') e CHECKs
-- condicionais que exigem os campos corretos por tipo (design: Single Table).
--
--   Pessoa : full_name, email, phone   (Req 1.3)
--   Empresa: legal_name, fiscal_document (Req 1.4)
--
-- Deduplicação (Req 5): índices únicos PARCIAIS ignoram contatos mesclados
-- (merged_into IS NOT NULL) para que a mesclagem não colida com o índice.
-- CITEXT garante unicidade case-insensitive de email e documento fiscal.

CREATE TABLE core.contacts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),          -- Req 1.1
  contact_type    TEXT NOT NULL CHECK (contact_type IN ('pessoa', 'empresa')), -- Req 1.2

  -- Campos de pessoa física
  full_name       TEXT,
  email           CITEXT,
  phone           TEXT,

  -- Campos de empresa (pessoa jurídica)
  legal_name      TEXT,
  fiscal_document CITEXT,

  -- Mesclagem (Req 5.5): NULL = contato ativo; preenchido aponta para o destino
  merged_into     UUID REFERENCES core.contacts (id),

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Completude de campos obrigatórios por tipo (Req 1.3, 1.4, 1.6)
  CONSTRAINT contacts_required_fields_by_type CHECK (
    (contact_type = 'pessoa'
      AND full_name IS NOT NULL
      AND email IS NOT NULL
      AND phone IS NOT NULL)
    OR
    (contact_type = 'empresa'
      AND legal_name IS NOT NULL
      AND fiscal_document IS NOT NULL)
  ),

  -- Validação de formato de e-mail quando presente (Req 1.5)
  CONSTRAINT contacts_email_format CHECK (
    email IS NULL OR email ~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$'
  )
);

-- Deduplicação de pessoa por e-mail entre contatos ativos (Req 5.1, 5.2)
CREATE UNIQUE INDEX uq_contacts_person_email
  ON core.contacts (email)
  WHERE contact_type = 'pessoa' AND merged_into IS NULL;

-- Deduplicação de empresa por documento fiscal entre contatos ativos (Req 5.3, 5.4)
CREATE UNIQUE INDEX uq_contacts_company_document
  ON core.contacts (fiscal_document)
  WHERE contact_type = 'empresa' AND merged_into IS NULL;

-- Acelera consultas por tipo e a navegação de mesclagem.
CREATE INDEX idx_contacts_type ON core.contacts (contact_type);
CREATE INDEX idx_contacts_merged_into ON core.contacts (merged_into) WHERE merged_into IS NOT NULL;

COMMENT ON TABLE core.contacts IS
  'Fonte única de verdade de contatos (pessoas e empresas). Módulos referenciam por contact_id, sem copiar dados (Req 7).';
