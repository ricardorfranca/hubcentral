ALTER TABLE core.users
  DROP COLUMN IF EXISTS invite_resent_at,
  DROP COLUMN IF EXISTS invited_at,
  DROP COLUMN IF EXISTS status,
  DROP COLUMN IF EXISTS role,
  DROP COLUMN IF EXISTS password_set,
  DROP COLUMN IF EXISTS password_hash;
