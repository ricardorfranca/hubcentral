-- Chaves de API externas ("usuários de sistema" para integrações).
--
-- Permitem que sistemas externos executem operações de forma controlada por
-- permissões (RBAC), como uma landing page enviando leads ao CRM. Segue o mesmo
-- princípio de segurança das sessões: o segredo em claro é mostrado UMA vez na
-- criação; o banco guarda apenas o hash SHA-256. Um prefixo curto (não secreto)
-- é armazenado para identificar a chave na UI e nos logs.

CREATE TABLE core.api_keys (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,                                  -- rótulo (ex.: "Landing Page — Site")
  prefix       TEXT NOT NULL,                                  -- primeiros caracteres do segredo (identificação)
  key_hash     TEXT NOT NULL UNIQUE,                           -- SHA-256 (hex) do segredo em claro
  status       TEXT NOT NULL DEFAULT 'active'
               CHECK (status IN ('active', 'revoked')),
  created_by   UUID REFERENCES core.users (id) ON DELETE SET NULL,
  last_used_at TIMESTAMPTZ,                                    -- última vez que autenticou uma requisição
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at   TIMESTAMPTZ
);

CREATE INDEX idx_api_keys_status ON core.api_keys (status);

-- Permissões (namespaces RBAC) concedidas a uma chave. Mesma gramática dos
-- namespaces de usuário (`[modulo]:[recurso]:[acao]`), mas atribuídas à chave.
CREATE TABLE core.api_key_permissions (
  api_key_id UUID NOT NULL REFERENCES core.api_keys (id) ON DELETE CASCADE,
  namespace  TEXT NOT NULL,
  PRIMARY KEY (api_key_id, namespace)
);

COMMENT ON TABLE core.api_keys IS
  'Chaves de API para integrações externas. Segredo só é exibido na criação; guarda-se apenas o hash SHA-256.';
COMMENT ON TABLE core.api_key_permissions IS
  'Namespaces RBAC concedidos a uma chave de API (mesma gramática dos namespaces de usuário).';
