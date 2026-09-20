-- Tabela central de usuários (IAM) — versão MÍNIMA.
--
-- O IAM completo (autenticação, RBAC, provisionamento) está FORA do escopo da
-- spec central-contacts-and-module-contract. Esta migration cria apenas o
-- suficiente para satisfazer as dependências desta feature:
--   * FK de core.segments.created_by  (Req 6.4)
--   * FK de core.system_logs.user_id  (Req 13.3)
--   * requires_core_tables = ["core.users", ...] no manifesto de módulo (Req 8.5)
--   * referência de usuário pelos módulos via user_id UUID (Req 9.2)
--
-- Colunas de identidade/credenciais serão adicionadas pela spec de IAM.

CREATE TABLE core.users (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email      CITEXT NOT NULL UNIQUE,
  full_name  TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE core.users IS
  'Fonte única de identidade do HUB Central (IAM). Versão mínima criada pela spec de contatos; ampliada pela spec de IAM.';
