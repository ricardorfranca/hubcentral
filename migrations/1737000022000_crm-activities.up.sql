-- CRM 2.0 — Atividades (cadência de vendas): ligações, e-mails, reuniões,
-- tarefas e notas, vinculáveis a conta, contato e/ou oportunidade.

CREATE TABLE mod_crm.activities (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id    UUID REFERENCES mod_crm.opportunities (id) ON DELETE CASCADE,
  account_id        UUID REFERENCES mod_crm.accounts (id) ON DELETE CASCADE,
  person_contact_id UUID REFERENCES core.contacts (id),
  type              TEXT NOT NULL CHECK (type IN ('ligacao', 'email', 'reuniao', 'tarefa', 'nota')),
  subject           VARCHAR(200) NOT NULL,
  notes             TEXT,
  assigned_to       UUID REFERENCES core.users (id),
  due_at            TIMESTAMPTZ,
  status            TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'concluida')),
  completed_at      TIMESTAMPTZ,
  created_by        UUID REFERENCES core.users (id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_crm_act_opp ON mod_crm.activities (opportunity_id);
CREATE INDEX idx_crm_act_assignee ON mod_crm.activities (assigned_to, status, due_at);

COMMENT ON TABLE mod_crm.activities IS
  'Atividades da cadência de vendas (Receita Previsível), ligadas a conta/contato/oportunidade.';
