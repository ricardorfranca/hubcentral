-- Módulo de Projetos Internos — comentários (projeto e tarefa) e anexos.

-- Comentários no nível do projeto.
CREATE TABLE mod_projetos.project_comments (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     UUID NOT NULL REFERENCES mod_projetos.projects (id) ON DELETE CASCADE,
  author_user_id UUID NOT NULL REFERENCES core.users (id),
  body           TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_projetos_project_comments ON mod_projetos.project_comments (project_id, created_at);

-- Comentários no nível da tarefa.
CREATE TABLE mod_projetos.task_comments (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id        UUID NOT NULL REFERENCES mod_projetos.tasks (id) ON DELETE CASCADE,
  author_user_id UUID NOT NULL REFERENCES core.users (id),
  body           TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_projetos_task_comments ON mod_projetos.task_comments (task_id, created_at);

-- Anexos de tarefa (metadados; arquivo em disco local via UPLOADS_DIR).
CREATE TABLE mod_projetos.task_attachments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id       UUID NOT NULL REFERENCES mod_projetos.tasks (id) ON DELETE CASCADE,
  original_name VARCHAR(255) NOT NULL,
  stored_name   VARCHAR(255) NOT NULL,               -- nome seguro no disco (uuid.ext)
  mime_type     VARCHAR(150),
  size_bytes    BIGINT NOT NULL,
  uploaded_by   UUID REFERENCES core.users (id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_projetos_attachments_task ON mod_projetos.task_attachments (task_id);

-- Seed das chaves de configuração de anexo na Central de Configurações (core.settings).
-- Idempotente: preserva valor já persistido, atualiza apenas metadados de exibição.
INSERT INTO core.settings (key, module, value, value_type, label, description, default_value) VALUES
  ('projetos.uploads.max_bytes', 'projetos', NULL, 'int',
   'Tamanho máximo de anexo (bytes)',
   'Limite de tamanho por arquivo anexado a uma tarefa.', '26214400'),
  ('projetos.uploads.allowed', 'projetos', NULL, 'csv',
   'Tipos de anexo permitidos',
   'Lista de extensões/MIME permitidos para anexos (separadas por vírgula).',
   'pdf,png,jpg,jpeg,gif,webp,txt,doc,docx,xls,xlsx,ppt,pptx,zip')
ON CONFLICT (key) DO UPDATE SET
  module = EXCLUDED.module,
  value_type = EXCLUDED.value_type,
  label = EXCLUDED.label,
  description = EXCLUDED.description,
  default_value = EXCLUDED.default_value;

COMMENT ON TABLE mod_projetos.task_attachments IS
  'Metadados de anexos de tarefa; arquivo em disco local. stored_name (uuid) evita path traversal.';
