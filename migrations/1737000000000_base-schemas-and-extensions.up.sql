-- Migration base do HUB Central.
-- Cria os schemas de isolamento estrito (design: "Isolamento estrito por schema")
-- e as extensões usadas pelo núcleo:
--   * pgcrypto  -> gen_random_uuid() para PKs UUID
--   * citext    -> comparação case-insensitive de e-mail/documento/nome de categoria

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

-- Schema do núcleo: usuários, IAM, contatos, auditoria, eventos, registro de módulos.
CREATE SCHEMA IF NOT EXISTS core;

-- Schema do primeiro módulo satélite (CRM). Demais módulos criam seus próprios
-- schemas mod_[nome] em suas respectivas migrations.
CREATE SCHEMA IF NOT EXISTS mod_crm;
