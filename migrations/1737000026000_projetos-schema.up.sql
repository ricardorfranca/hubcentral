-- Módulo de Projetos Internos — schema e tabelas base (projetos e membros).
--
-- Voltado aos usuários do sistema (core.users). Referencia core.users apenas
-- por user_id, sem duplicar dados de usuário (Contrato de Módulos).

CREATE SCHEMA IF NOT EXISTS mod_projetos;

-- Projeto interno: nome, descrição curta, descritivo principal (rico), dono e status.
CREATE TABLE mod_projetos.projects (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(200) NOT NULL,
  description   VARCHAR(500),                                   -- descrição curta
  detail        TEXT,                                           -- Descritivo_Principal (rico/detalhado)
  owner_user_id UUID NOT NULL REFERENCES core.users (id),
  status        TEXT NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'arquivado')),
  created_by    UUID REFERENCES core.users (id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_projetos_projects_owner ON mod_projetos.projects (owner_user_id);
CREATE INDEX idx_projetos_projects_status ON mod_projetos.projects (status);

-- Membros do projeto (N:N com core.users). O dono também é adicionado como membro.
CREATE TABLE mod_projetos.project_members (
  project_id UUID NOT NULL REFERENCES mod_projetos.projects (id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES core.users (id) ON DELETE CASCADE,
  added_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);

CREATE INDEX idx_projetos_members_user ON mod_projetos.project_members (user_id);

COMMENT ON TABLE mod_projetos.projects IS
  'Projetos internos; referenciam core.users (dono/membros) sem duplicar dados de usuário.';
COMMENT ON TABLE mod_projetos.project_members IS
  'Participantes do projeto (N:N). Acesso ao projeto restrito a dono ou membro.';
