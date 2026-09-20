-- core.registered_modules — módulos satélites registrados no HUB Central (Req 8).

CREATE TABLE core.registered_modules (
  module_id     TEXT PRIMARY KEY,                            -- único (Req 8.3)
  manifest      JSONB NOT NULL,                              -- Manifesto_Modulo completo
  version       TEXT NOT NULL,                               -- SemVer (Req 8.8)
  registered_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE core.registered_modules IS
  'Registro de módulos satélites. module_id único; manifesto validado no ModuleRegistry.';
