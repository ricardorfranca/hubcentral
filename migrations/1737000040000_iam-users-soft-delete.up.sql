-- Permite marcar um usuário como excluído (lápide) sem apagar a linha física,
-- preservando o id para a integridade de core.system_logs (imutável). A exclusão
-- de usuário é lógica: status='deleted', PII anonimizada e id intacto.

-- Descobre o nome real do CHECK de status (gerado pelo Postgres, inline em
-- 1737000014000, sem nome explícito) e o remove de forma robusta, sem depender
-- de nome fixo.
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

-- Recria o CHECK com nome explícito (torna migrations futuras determinísticas)
-- admitindo o novo status de lápide.
ALTER TABLE core.users
  ADD CONSTRAINT users_status_check CHECK (status IN ('active', 'disabled', 'deleted'));

ALTER TABLE core.users
  ADD COLUMN deleted_at TIMESTAMPTZ,                                       -- quando virou lápide (NULL = ativo)
  ADD COLUMN deleted_by UUID REFERENCES core.users (id) ON DELETE SET NULL; -- autor da exclusão

COMMENT ON COLUMN core.users.status IS
  'active | disabled | deleted (lápide: usuário anonimizado, preservado só para integridade dos logs).';
