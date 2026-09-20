-- Projetos 2.0 — prazos, dependências, visibilidade, responsável único,
-- cores de alerta configuráveis, apontamento de tempo e recursos/custos.

-- Projeto: prazo total, valor/hora padrão e limites de alerta configuráveis.
ALTER TABLE mod_projetos.projects
  ADD COLUMN due_date        DATE,
  ADD COLUMN hourly_rate     NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (hourly_rate >= 0),
  ADD COLUMN warn_days       INTEGER NOT NULL DEFAULT 2 CHECK (warn_days >= 0);

-- Tarefa: prazo, responsável único, visibilidade e overrides de alerta.
ALTER TABLE mod_projetos.tasks
  ADD COLUMN due_date        DATE,
  ADD COLUMN assignee_user_id UUID REFERENCES core.users (id),  -- responsável único
  ADD COLUMN visible_to_all  BOOLEAN NOT NULL DEFAULT true,      -- visível a todos do projeto
  ADD COLUMN warn_days       INTEGER;                            -- override do alerta (NULL = usa o do projeto)

-- Migra atribuições N:N existentes para responsável único (pega a primeira, se houver).
UPDATE mod_projetos.tasks t
SET assignee_user_id = a.user_id
FROM (
  SELECT DISTINCT ON (task_id) task_id, user_id
  FROM mod_projetos.task_assignees
  ORDER BY task_id, user_id
) a
WHERE a.task_id = t.id AND t.assignee_user_id IS NULL;

-- Dependência entre tarefas: uma tarefa depende de outra (que deve finalizar
-- antes de esta iniciar). Uma dependência por tarefa nesta versão.
ALTER TABLE mod_projetos.tasks
  ADD COLUMN depends_on_task_id UUID REFERENCES mod_projetos.tasks (id) ON DELETE SET NULL;

-- Apontamento de tempo por comentário (em minutos).
ALTER TABLE mod_projetos.task_comments
  ADD COLUMN minutes INTEGER NOT NULL DEFAULT 0 CHECK (minutes >= 0);

-- Recursos e custos do projeto (custos diversos, além das horas de pessoas).
CREATE TABLE mod_projetos.project_resources (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID NOT NULL REFERENCES mod_projetos.projects (id) ON DELETE CASCADE,
  description VARCHAR(200) NOT NULL,
  cost        NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (cost >= 0),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_projetos_resources_project ON mod_projetos.project_resources (project_id);

COMMENT ON COLUMN mod_projetos.projects.due_date IS 'Prazo total do projeto; prazos de tarefas não devem ultrapassá-lo.';
COMMENT ON COLUMN mod_projetos.tasks.depends_on_task_id IS 'Tarefa da qual esta depende (deve estar finalizada para iniciar).';
COMMENT ON COLUMN mod_projetos.tasks.visible_to_all IS 'Se true, todos do projeto veem; se false, só dono do projeto e responsável.';
COMMENT ON COLUMN mod_projetos.task_comments.minutes IS 'Tempo apontado no comentário, em minutos (somado no card e no projeto).';
COMMENT ON TABLE mod_projetos.project_resources IS 'Custos diversos do projeto (R$), além das horas de pessoas.';
