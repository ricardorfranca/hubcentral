-- core.settings — Central de Configurações do HUB Central.
--
-- Serviço genérico do núcleo: cada módulo registra suas chaves (namespaced por
-- `modulo.recurso.parametro`) com tipo, rótulo, descrição e default. A UI de
-- administração agrupa por `module`. Resolução de valor efetivo:
--   valor persistido (`value`) -> `default_value` -> variável de ambiente (fallback).

CREATE TABLE core.settings (
  key           TEXT PRIMARY KEY,                    -- ex.: projetos.uploads.max_bytes
  module        TEXT NOT NULL,                       -- crm|projetos|core
  value         TEXT,                                -- valor atual (serializado); NULL = usa default
  value_type    TEXT NOT NULL CHECK (value_type IN ('int', 'bool', 'string', 'json', 'csv')),
  label         TEXT NOT NULL,                       -- rótulo de exibição
  description   TEXT,                                -- ajuda
  default_value TEXT,                                -- default (fallback)
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by    UUID REFERENCES core.users (id)
);

CREATE INDEX idx_settings_module ON core.settings (module);

COMMENT ON TABLE core.settings IS
  'Central de Configurações do HUB Central; parâmetros por módulo (persistido -> default -> env).';
