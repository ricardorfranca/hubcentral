-- Projetos — concede o baseline de PARTICIPANTE aos usuários já existentes.
--
-- Causa: membros de projeto que não são superadmin nasciam sem nenhum namespace
-- e nunca recebiam `projetos:projeto:editar`; por isso não conseguiam editar o
-- título nem o tempo estimado de um projeto do qual participam (o gate de edição,
-- no backend e na UI, exige esse namespace). Novos usuários passam a receber o
-- baseline no provisionamento (`inviteUser`); esta migration faz o mesmo,
-- retroativamente, para os usuários que já existem.
--
-- A lista abaixo DEVE ser mantida em sintonia com PROJETOS_PARTICIPANT_NAMESPACES
-- (src/core/iam/namespaces.ts). Fica de fora `projetos:membros:gerenciar` (ação
-- mais privilegiada). A participação segue verificada por `assertProjectAccess`
-- em runtime, então o baseline não concede acesso a projetos alheios.
--
-- Idempotente (ON CONFLICT DO NOTHING). Não toca em superadmins (já têm tudo)
-- nem em lápides (status = 'deleted').
INSERT INTO core.user_permissions (user_id, namespace)
SELECT u.id, t.ns
FROM core.users u
CROSS JOIN (VALUES
  ('projetos:projeto:visualizar'),
  ('projetos:projeto:criar'),
  ('projetos:projeto:editar'),
  ('projetos:projeto:arquivar'),
  ('projetos:tarefa:visualizar'),
  ('projetos:tarefa:criar'),
  ('projetos:tarefa:editar'),
  ('projetos:tarefa:mover'),
  ('projetos:tarefa:atribuir'),
  ('projetos:comentario:criar'),
  ('projetos:anexo:enviar'),
  ('projetos:anexo:baixar'),
  ('projetos:anexo:excluir'),
  ('projetos:notificacoes:visualizar')
) AS t(ns)
WHERE u.role <> 'superadmin' AND u.status <> 'deleted'
ON CONFLICT (user_id, namespace) DO NOTHING;
