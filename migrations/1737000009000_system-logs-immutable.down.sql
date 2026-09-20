DROP TRIGGER IF EXISTS trg_system_logs_no_delete ON core.system_logs;
DROP TRIGGER IF EXISTS trg_system_logs_no_update ON core.system_logs;
DROP FUNCTION IF EXISTS core.deny_system_logs_mutation();
