-- Reverte o baseline de participante concedido aos usuários não-superadmin.
-- Remove apenas os 14 namespaces do baseline (mesma lista do .up.sql /
-- PROJETOS_PARTICIPANT_NAMESPACES) e apenas de usuários não-superadmin, para
-- não afetar concessões feitas por outros meios ao superadmin.
DELETE FROM core.user_permissions
WHERE namespace IN (
  'projetos:projeto:visualizar',
  'projetos:projeto:criar',
  'projetos:projeto:editar',
  'projetos:projeto:arquivar',
  'projetos:tarefa:visualizar',
  'projetos:tarefa:criar',
  'projetos:tarefa:editar',
  'projetos:tarefa:mover',
  'projetos:tarefa:atribuir',
  'projetos:comentario:criar',
  'projetos:anexo:enviar',
  'projetos:anexo:baixar',
  'projetos:anexo:excluir',
  'projetos:notificacoes:visualizar'
)
AND user_id IN (SELECT id FROM core.users WHERE role <> 'superadmin');
