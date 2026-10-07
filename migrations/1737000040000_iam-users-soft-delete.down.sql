-- Reversão da lápide (down DESTRUTIVO-DE-ESTADO): o CHECK antigo não admite
-- status='deleted', então qualquer lápide existente é normalizada para
-- 'disabled' ANTES de recriar o CHECK antigo; sem isso o ADD CONSTRAINT falharia
-- com check_violation e o rollback travaria.
UPDATE core.users SET status = 'disabled' WHERE status = 'deleted';

ALTER TABLE core.users DROP COLUMN IF EXISTS deleted_by;
ALTER TABLE core.users DROP COLUMN IF EXISTS deleted_at;

-- Remove o CHECK atual (nome robusto, descoberta dinâmica) e recria o antigo.
DO $$
DECLARE cname text;
BEGIN
  SELECT conname INTO cname
  FROM pg_constraint
  WHERE conrelid = 'core.users'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%status%';
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE core.users DROP CONSTRAINT %I', cname);
  END IF;
END $$;

ALTER TABLE core.users
  ADD CONSTRAINT users_status_check CHECK (status IN ('active', 'disabled'));
