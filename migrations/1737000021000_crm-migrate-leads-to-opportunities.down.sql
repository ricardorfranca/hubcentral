-- Reversão da migração de dados: remove oportunidades cujo id corresponde a um
-- lead migrado (e seus vínculos). Não remove contas (podem ter uso próprio).
DELETE FROM mod_crm.opportunity_contacts
  WHERE opportunity_id IN (SELECT id FROM mod_crm.leads);
DELETE FROM mod_crm.opportunities
  WHERE id IN (SELECT id FROM mod_crm.leads);
