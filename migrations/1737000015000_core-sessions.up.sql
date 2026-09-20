-- core.sessions — sessões de autenticação por token (IAM).
--
-- Guardamos apenas o HASH do token (nunca o token em claro), como boas
-- práticas: quem tem o banco não recupera tokens ativos. A sessão expira em
-- expires_at e pode ser revogada (revoked_at).

CREATE TABLE core.sessions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES core.users (id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,                            -- SHA-256 do token opaco
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ                                       -- NULL = ativa
);

CREATE INDEX idx_sessions_user ON core.sessions (user_id);

COMMENT ON TABLE core.sessions IS
  'Sessões de autenticação. Armazena apenas o hash do token; expira em expires_at; revogável.';
