-- mod_crm.leads — leads do CRM referenciando contatos centrais (Req 14).
--
-- CRÍTICO (objetivo da spec): a tabela NÃO copia dados de contato. Em vez de
-- name/company/email/phone, guarda referências para core.contacts:
--   * person_contact_id  -> Contato_Pessoa do lead
--   * company_contact_id -> Contato_Empresa do lead
-- Os dados de contato são lidos da Base Central via ContactService.getContactData.
--
-- As demais colunas de negócio do lead (pipeline, SLA, valores, status)
-- permanecem no módulo, pois não são dados de contato.

CREATE TABLE mod_crm.leads (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_contact_id  UUID NOT NULL REFERENCES core.contacts (id),   -- Req 14.1
  company_contact_id UUID REFERENCES core.contacts (id),            -- Req 14.1 (opcional)
  assigned_to        UUID REFERENCES core.users (id),               -- vendedor (IAM)
  column_id          VARCHAR(50) NOT NULL DEFAULT 'novo',           -- etapa do pipeline
  status             TEXT NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active', 'won', 'lost', 'discarded')),
  value_activation   DECIMAL(12, 2),
  value_monthly      DECIMAL(12, 2),
  created_by         UUID REFERENCES core.users (id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_crm_leads_person ON mod_crm.leads (person_contact_id);
CREATE INDEX idx_crm_leads_company ON mod_crm.leads (company_contact_id);
CREATE INDEX idx_crm_leads_status ON mod_crm.leads (status);

COMMENT ON TABLE mod_crm.leads IS
  'Leads do CRM. Referenciam contatos centrais por contact_id (Req 14). Nenhum dado de contato é copiado.';
