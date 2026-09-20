-- Reversão da migration base. Remove os schemas (e seu conteúdo) na ordem inversa.
-- As extensões são mantidas pois podem ser usadas por outros bancos/roles.

DROP SCHEMA IF EXISTS mod_crm CASCADE;
DROP SCHEMA IF EXISTS core CASCADE;
