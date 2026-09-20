-- Módulo de Projetos Internos — tarefas (Kanban de 3 colunas fixas) e atribuições.

-- Tarefa (card). status = coluna do Kanban; position = ordem manual na coluna.
CREATE TABLE mod_projetos.tasks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID NOT NULL REFERENCES mod_projetos.projects (id) ON DELETE CASCADE,
  title       VARCHAR(200) NOT NULL,
  description TEXT,
  status      TEXT NOT NULL DEFAULT 'nao_iniciada'
              CHECK (status IN ('nao_iniciada', 'em_execucao', 'finalizada')),
  position    INTEGER NOT NULL DEFAULT 0,
  created_by  UUID REFERENCES core.users (id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_projetos_tasks_board ON mod_projetos.tasks (project_id, status, position);

-- Atribuição N:N tarefa <-> usuário (responsáveis pela execução).
CREATE TABLE mod_projetos.task_assignees (
  task_id UUID NOT NULL REFERENCES mod_projetos.tasks (id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES core.users (id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, user_id)
);

CREATE INDEX idx_projetos_assignees_user ON mod_projetos.task_assignees (user_id);

COMMENT ON TABLE mod_projetos.tasks IS
  'Tarefas (cards) do Kanban; status é uma das 3 colunas fixas. position ordena dentro da coluna.';
