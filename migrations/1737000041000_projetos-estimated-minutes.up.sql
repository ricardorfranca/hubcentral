-- Projetos — tempo estimado/orçado do projeto.
-- Novo tempo editável, distinto do tempo APONTADO (agregado de task_comments.minutes).
-- Armazenado em MINUTOS para coerência com o restante do módulo (task_comments.minutes,
-- totals.total_minutes). A UI expõe o valor em horas e converte horas↔minutos na borda.
ALTER TABLE mod_projetos.projects
  ADD COLUMN estimated_minutes INTEGER CHECK (estimated_minutes >= 0);

COMMENT ON COLUMN mod_projetos.projects.estimated_minutes IS
  'Tempo estimado/orçado do projeto, em minutos (editável). Distinto do tempo apontado (soma de task_comments.minutes).';
