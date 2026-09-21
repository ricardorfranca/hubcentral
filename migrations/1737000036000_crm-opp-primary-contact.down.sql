DROP INDEX IF EXISTS mod_crm.idx_crm_opp_primary_contact;

ALTER TABLE mod_crm.opportunities
  DROP COLUMN IF EXISTS primary_contact_id;
