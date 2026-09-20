-- Ampliação de core.users para o IAM completo (§2 da arquitetura).
--
-- Acrescenta credenciais e ciclo de provisionamento à tabela mínima criada
-- pela spec de contatos. Colunas nullable/COM DEFAULT para não quebrar linhas
-- e FKs existentes.

ALTER TABLE core.users
  ADD COLUMN password_hash    TEXT,                          -- salt:hash (scrypt); NULL até definir
  ADD COLUMN password_set     BOOLEAN NOT NULL DEFAULT false, -- primeiro acesso pendente
  ADD COLUMN role             TEXT NOT NULL DEFAULT 'operator'
    CHECK (role IN ('superadmin', 'module_admin', 'operator', 'client')), -- níveis §2.2
  ADD COLUMN status           TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'disabled')),
  ADD COLUMN invited_at       TIMESTAMPTZ,                    -- quando o convite foi criado
  ADD COLUMN invite_resent_at TIMESTAMPTZ;                    -- último reenvio (cooldown)

COMMENT ON COLUMN core.users.role IS
  'Nível de acesso: superadmin, module_admin, operator, client (§2.2 da arquitetura).';
