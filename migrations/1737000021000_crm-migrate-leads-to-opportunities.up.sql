-- CRM 2.0 — migra os leads existentes para o modelo Conta + Oportunidade.
--
-- Cada lead vira: uma Conta (a partir do company_contact_id, quando houver) e
-- uma Oportunidade (person via opportunity_contacts, valores mapeados). Leads
-- sem empresa vinculada são ignorados nesta migração automática (podem ser
-- recriados manualmente como oportunidade com conta).
--
-- Mapeamento de valores: value_monthly -> mrr, value_activation -> one_time.
-- Mapeamento de etapa antiga -> estágio novo.

-- 1) Cria contas para as empresas referenciadas por leads que ainda não têm conta.
INSERT INTO mod_crm.accounts (company_contact_id, owner_user_id)
SELECT DISTINCT l.company_contact_id, l.assigned_to
FROM mod_crm.leads l
WHERE l.company_contact_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM mod_crm.accounts a WHERE a.company_contact_id = l.company_contact_id
  );

-- 2) Registra a referência de contato das novas contas (contrato de módulo).
INSERT INTO core.contact_references (module, table_name, contact_id)
SELECT 'mod_crm', 'accounts', a.company_contact_id
FROM mod_crm.accounts a
ON CONFLICT (module, table_name, contact_id) DO NOTHING;

-- 3) Cria uma oportunidade por lead (que tenha empresa/conta).
INSERT INTO mod_crm.opportunities
  (id, account_id, name, stage_id, probability, mrr, one_time, owner_user_id, status, created_at)
SELECT
  l.id,                                        -- preserva o id do lead como id da oportunidade
  a.id,
  'Oportunidade migrada',
  CASE l.column_id
    WHEN 'novo' THEN 'novo'
    WHEN 'ligacao' THEN 'qualificacao'
    WHEN 'proposta' THEN 'proposta'
    WHEN 'reuniao' THEN 'negociacao'
    WHEN 'acompanhamento' THEN 'descoberta'
    WHEN 'ganho' THEN 'ganho'
    WHEN 'perdido' THEN 'perdido'
    ELSE 'novo'
  END,
  COALESCE((SELECT probability FROM mod_crm.stages s WHERE s.id =
    CASE l.column_id
      WHEN 'novo' THEN 'novo' WHEN 'ligacao' THEN 'qualificacao' WHEN 'proposta' THEN 'proposta'
      WHEN 'reuniao' THEN 'negociacao' WHEN 'acompanhamento' THEN 'descoberta'
      WHEN 'ganho' THEN 'ganho' WHEN 'perdido' THEN 'perdido' ELSE 'novo' END), 0),
  COALESCE(l.value_monthly, 0),
  COALESCE(l.value_activation, 0),
  l.assigned_to,
  CASE l.status WHEN 'won' THEN 'won' WHEN 'lost' THEN 'lost' ELSE 'open' END,
  l.created_at
FROM mod_crm.leads l
JOIN mod_crm.accounts a ON a.company_contact_id = l.company_contact_id
WHERE l.company_contact_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM mod_crm.opportunities o WHERE o.id = l.id);

-- 4) Vincula a pessoa do lead como contato da oportunidade e da conta.
INSERT INTO mod_crm.opportunity_contacts (opportunity_id, person_contact_id, role)
SELECT l.id, l.person_contact_id, 'contato'
FROM mod_crm.leads l
JOIN mod_crm.opportunities o ON o.id = l.id
ON CONFLICT DO NOTHING;

INSERT INTO mod_crm.account_contacts (account_id, person_contact_id, role)
SELECT o.account_id, l.person_contact_id, 'contato'
FROM mod_crm.leads l
JOIN mod_crm.opportunities o ON o.id = l.id
ON CONFLICT DO NOTHING;
