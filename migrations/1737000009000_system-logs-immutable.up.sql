-- Reforço de imutabilidade de core.system_logs (Req 13.4).
--
-- A tabela é append-only. Além do REVOKE de UPDATE/DELETE para a role de
-- aplicação (aplicado no provisionamento de ambiente), uma trigger
-- BEFORE UPDATE OR DELETE bloqueia qualquer alteração/remoção, valendo para
-- QUALQUER role (inclusive superuser). Esta é a garantia efetiva e testável.

CREATE OR REPLACE FUNCTION core.deny_system_logs_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'core.system_logs é imutável: % não é permitido', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_system_logs_no_update
  BEFORE UPDATE ON core.system_logs
  FOR EACH ROW EXECUTE FUNCTION core.deny_system_logs_mutation();

CREATE TRIGGER trg_system_logs_no_delete
  BEFORE DELETE ON core.system_logs
  FOR EACH ROW EXECUTE FUNCTION core.deny_system_logs_mutation();

COMMENT ON FUNCTION core.deny_system_logs_mutation() IS
  'Bloqueia UPDATE/DELETE em core.system_logs, garantindo auditoria imutável (Req 13.4).';
