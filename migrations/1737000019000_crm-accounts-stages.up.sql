-- CRM 2.0 — Contas (B2B) e estágios do pipeline (Receita Previsível).

-- Conta corporativa: referencia core.contacts (empresa, com CNPJ). Nenhum dado
-- de contato é copiado — só a referência (contrato de módulos).
CREATE TABLE mod_crm.accounts (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_contact_id UUID NOT NULL REFERENCES core.contacts (id),
  segment            VARCHAR(100),
  size_tier          VARCHAR(50),                 -- ex.: PME, Mid-Market, Enterprise
  owner_user_id      UUID REFERENCES core.users (id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_account_company UNIQUE (company_contact_id)
);

CREATE INDEX idx_crm_accounts_owner ON mod_crm.accounts (owner_user_id);

-- Contatos vinculados à conta (N:N, com papel).
CREATE TABLE mod_crm.account_contacts (
  account_id        UUID NOT NULL REFERENCES mod_crm.accounts (id) ON DELETE CASCADE,
  person_contact_id UUID NOT NULL REFERENCES core.contacts (id),
  role              VARCHAR(50),                  -- decisor|influenciador|tecnico
  PRIMARY KEY (account_id, person_contact_id)
);

-- Estágios configuráveis do pipeline, com probabilidade.
CREATE TABLE mod_crm.stages (
  id          VARCHAR(50) PRIMARY KEY,
  label       VARCHAR(100) NOT NULL,
  position    INTEGER NOT NULL,
  probability INTEGER NOT NULL CHECK (probability BETWEEN 0 AND 100),
  terminal    BOOLEAN NOT NULL DEFAULT false,
  won_lost    TEXT CHECK (won_lost IN ('won', 'lost'))
);

-- Pipeline padrão de Receita Previsível.
INSERT INTO mod_crm.stages (id, label, position, probability, terminal, won_lost) VALUES
  ('novo',         'Novo',          1, 10,  false, NULL),
  ('qualificacao', 'Qualificação',  2, 25,  false, NULL),
  ('descoberta',   'Descoberta',    3, 40,  false, NULL),
  ('proposta',     'Proposta',      4, 60,  false, NULL),
  ('negociacao',   'Negociação',    5, 80,  false, NULL),
  ('ganho',        'Ganho',         6, 100, true,  'won'),
  ('perdido',      'Perdido',       7, 0,   true,  'lost');

COMMENT ON TABLE mod_crm.accounts IS 'Contas B2B; referenciam empresa em core.contacts (CNPJ). Sem duplicar dados de contato.';
COMMENT ON TABLE mod_crm.stages IS 'Estágios configuráveis do pipeline, com probabilidade para forecast ponderado.';
