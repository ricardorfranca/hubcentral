-- CRM 2.0 — Contato primário da oportunidade (com quem devemos nos comunicar).
-- Referencia uma pessoa em core.contacts; opcional. A oportunidade continua
-- pertencendo a uma conta (empresa), mas passa a apontar o contato principal.

ALTER TABLE mod_crm.opportunities
  ADD COLUMN primary_contact_id UUID REFERENCES core.contacts (id);

CREATE INDEX idx_crm_opp_primary_contact ON mod_crm.opportunities (primary_contact_id);

COMMENT ON COLUMN mod_crm.opportunities.primary_contact_id IS
  'Pessoa (core.contacts) que é o contato principal de comunicação da oportunidade.';
