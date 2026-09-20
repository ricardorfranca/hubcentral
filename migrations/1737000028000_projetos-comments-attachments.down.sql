DELETE FROM core.settings WHERE key IN ('projetos.uploads.max_bytes', 'projetos.uploads.allowed');
DROP TABLE IF EXISTS mod_projetos.task_attachments;
DROP TABLE IF EXISTS mod_projetos.task_comments;
DROP TABLE IF EXISTS mod_projetos.project_comments;
