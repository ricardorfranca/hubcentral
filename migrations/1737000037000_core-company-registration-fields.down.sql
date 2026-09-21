DROP INDEX IF EXISTS core.uq_ccl_company_principal;

COMMENT ON COLUMN core.contact_company_links.role IS NULL;

DROP INDEX IF EXISTS core.idx_contacts_company_contract_active;
DROP INDEX IF EXISTS core.idx_contacts_account_manager;

ALTER TABLE core.contacts
  DROP CONSTRAINT IF EXISTS contacts_state_format,
  DROP CONSTRAINT IF EXISTS contacts_zip_code_format;

ALTER TABLE core.contacts
  DROP COLUMN IF EXISTS account_manager_user_id,
  DROP COLUMN IF EXISTS phone_secondary_is_whatsapp,
  DROP COLUMN IF EXISTS phone_secondary,
  DROP COLUMN IF EXISTS phone_primary_is_whatsapp,
  DROP COLUMN IF EXISTS phone_primary,
  DROP COLUMN IF EXISTS state,
  DROP COLUMN IF EXISTS city,
  DROP COLUMN IF EXISTS neighborhood,
  DROP COLUMN IF EXISTS address_complement,
  DROP COLUMN IF EXISTS address_number,
  DROP COLUMN IF EXISTS street_address,
  DROP COLUMN IF EXISTS zip_code,
  DROP COLUMN IF EXISTS website,
  DROP COLUMN IF EXISTS state_tax_id,
  DROP COLUMN IF EXISTS contract_active;
