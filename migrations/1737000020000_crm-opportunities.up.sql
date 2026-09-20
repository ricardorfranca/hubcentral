-- CRM 2.0 — Oportunidades (efêmeras e repetíveis por conta).

CREATE TABLE mod_crm.opportunities (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id     UUID NOT NULL REFERENCES mod_crm.accounts (id),
  name           VARCHAR(200) NOT NULL,
  stage_id       VARCHAR(50) NOT NULL REFERENCES mod_crm.stages (id),
  probability    INTEGER NOT NULL DEFAULT 0 CHECK (probability BETWEEN 0 AND 100),
  mrr            NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (mrr >= 0),   -- recorrente mensal
  one_time       NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (one_time >= 0), -- valor único
  origin         TEXT CHECK (origin IN ('inbound', 'outbound', 'indicacao')),
  qualification  TEXT CHECK (qualification IN ('frio', 'morno', 'quente')),
  owner_user_id  UUID REFERENCES core.users (id),                      -- closer
  status         TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'won', 'lost')),
  loss_reason    VARCHAR(200),
  expected_close TIMESTAMPTZ,
  created_by     UUID REFERENCES core.users (id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_crm_opp_account ON mod_crm.opportunities (account_id);
CREATE INDEX idx_crm_opp_stage ON mod_crm.opportunities (stage_id);
CREATE INDEX idx_crm_opp_owner ON mod_crm.opportunities (owner_user_id);
CREATE INDEX idx_crm_opp_status ON mod_crm.opportunities (status);

-- Contatos envolvidos numa oportunidade (N:N, papel específico da negociação).
CREATE TABLE mod_crm.opportunity_contacts (
  opportunity_id    UUID NOT NULL REFERENCES mod_crm.opportunities (id) ON DELETE CASCADE,
  person_contact_id UUID NOT NULL REFERENCES core.contacts (id),
  role              VARCHAR(50),
  PRIMARY KEY (opportunity_id, person_contact_id)
);

COMMENT ON TABLE mod_crm.opportunities IS
  'Oportunidades de venda (efêmeras/repetíveis). MRR (recorrente) + one_time (único); ARR=mrr*12 derivado.';
