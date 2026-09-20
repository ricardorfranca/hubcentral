DROP TABLE IF EXISTS mod_projetos.project_resources;

ALTER TABLE mod_projetos.task_comments DROP COLUMN IF EXISTS minutes;

ALTER TABLE mod_projetos.tasks
  DROP COLUMN IF EXISTS depends_on_task_id,
  DROP COLUMN IF EXISTS warn_days,
  DROP COLUMN IF EXISTS visible_to_all,
  DROP COLUMN IF EXISTS assignee_user_id,
  DROP COLUMN IF EXISTS due_date;

ALTER TABLE mod_projetos.projects
  DROP COLUMN IF EXISTS warn_days,
  DROP COLUMN IF EXISTS hourly_rate,
  DROP COLUMN IF EXISTS due_date;
