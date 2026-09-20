-- core.user_permissions — atribuição de namespaces RBAC a usuários (Req 10).
--
-- A atribuição é feita pelo Administrador_Modulo/SuperAdministrador via IAM
-- (Req 10.5). Esta tabela guarda os namespaces concedidos a cada usuário para
-- a verificação de autorização (Req 10.3, 10.4).

CREATE TABLE core.user_permissions (
  user_id    UUID NOT NULL REFERENCES core.users (id) ON DELETE CASCADE,
  namespace  TEXT NOT NULL,                                  -- [modulo]:[recurso]:[acao]
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, namespace)
);

CREATE INDEX idx_user_permissions_ns ON core.user_permissions (namespace);

COMMENT ON TABLE core.user_permissions IS
  'Namespaces RBAC concedidos a usuários. Verificação de autorização das ações de módulo.';
