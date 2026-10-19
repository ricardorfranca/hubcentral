/**
 * @file namespaces.ts
 * @module core/iam
 *
 * Catálogo de namespaces RBAC conhecidos do HUB Central (núcleo + módulos).
 * Usado para conceder acesso total ao SuperAdministrador no bootstrap.
 */

/** Namespaces do núcleo (core). */
export const CORE_NAMESPACES: readonly string[] = [
  "core:contatos:visualizar",
  "core:contatos:criar",
  "core:contatos:editar",
  "core:contatos:excluir",
  "core:contatos:exportar",
  "core:contatos:importar",
  "core:segmentos:visualizar",
  "core:segmentos:criar",
  "core:modulos:registrar",
  "core:usuarios:gerenciar",
  "core:config:gerenciar",
  "core:backup:gerenciar",
];

/** Namespaces do módulo CRM (§3 do ModuloCRM). */
export const CRM_NAMESPACES: readonly string[] = [
  "crm:leads:visualizar",
  "crm:leads:criar",
  "crm:leads:editar",
  "crm:leads:descartar_suave",
  "crm:leads:descartar_definitivo",
  "crm:leads:exportar",
  "crm:leads:importar",
  "crm:pipeline:visualizar",
  "crm:pipeline:mover",
  "crm:pipeline:finalizar",
  "crm:pipeline:enviar_alerta",
  "crm:dashboard:visualizar_equipe",
  "crm:dashboard:visualizar_financeiro",
  "crm:campanhas:visualizar",
  "crm:campanhas:criar",
  "crm:campanhas:editar",
  "crm:campanhas:disparar",
  "crm:relatorios:fechamentos",
  "crm:relatorios:motivos_perda",
  "crm:relatorios:performance",
  "crm:relatorios:sla",
  "crm:relatorios:exportar",
  "crm:conversas:visualizar",
  "crm:conversas:enviar_mensagem",
  "crm:conversas:enviar_alerta",
  "crm:config:sla",
  "crm:config:listas",
  "crm:config:canais",
  "crm:config:integracoes",
  "crm:config:usuarios:criar",
  "crm:config:usuarios:editar_dados",
  "crm:config:usuarios:alterar_perfil",
  // CRM 2.0 — Receita Previsível
  "crm:contas:visualizar",
  "crm:contas:criar",
  "crm:contas:editar",
  "crm:oportunidades:visualizar",
  "crm:oportunidades:criar",
  "crm:oportunidades:editar",
  "crm:oportunidades:mover",
  "crm:oportunidades:finalizar",
  "crm:atividades:visualizar",
  "crm:atividades:gerenciar",
  "crm:forecast:visualizar",
];

/** Namespaces do Módulo de Projetos Internos. */
export const PROJETOS_NAMESPACES: readonly string[] = [
  "projetos:projeto:visualizar",
  "projetos:projeto:criar",
  "projetos:projeto:editar",
  "projetos:projeto:arquivar",
  "projetos:membros:gerenciar",
  "projetos:tarefa:visualizar",
  "projetos:tarefa:criar",
  "projetos:tarefa:editar",
  "projetos:tarefa:mover",
  "projetos:tarefa:atribuir",
  "projetos:comentario:criar",
  "projetos:anexo:enviar",
  "projetos:anexo:baixar",
  "projetos:anexo:excluir",
  "projetos:notificacoes:visualizar",
];

/**
 * Baseline de PARTICIPANTE do Módulo de Projetos: os namespaces que um usuário
 * precisa para operar um projeto do qual participa (dono ou membro), incluindo
 * `projetos:projeto:editar` (editar título e tempo estimado).
 *
 * É um subconjunto de {@link PROJETOS_NAMESPACES}. Fica de fora
 * `projetos:membros:gerenciar`: gerir membros é uma ação mais privilegiada e
 * concedê-la a todo participante afrouxaria o acesso além do necessário. A
 * participação no projeto continua sendo verificada em runtime por
 * `assertProjectAccess` (dono OU membro OU superadmin), de modo que ter este
 * baseline NÃO autoriza um não-participante a editar um projeto alheio.
 *
 * Usado pelo provisionamento de novos usuários (`inviteUser`) e espelhado pela
 * migration que concede o baseline aos usuários já existentes.
 */
export const PROJETOS_PARTICIPANT_NAMESPACES: readonly string[] = [
  "projetos:projeto:visualizar",
  "projetos:projeto:criar",
  "projetos:projeto:editar",
  "projetos:projeto:arquivar",
  "projetos:tarefa:visualizar",
  "projetos:tarefa:criar",
  "projetos:tarefa:editar",
  "projetos:tarefa:mover",
  "projetos:tarefa:atribuir",
  "projetos:comentario:criar",
  "projetos:anexo:enviar",
  "projetos:anexo:baixar",
  "projetos:anexo:excluir",
  "projetos:notificacoes:visualizar",
];

/**
 * Namespaces da API externa. São as capacidades que podem ser concedidas a uma
 * CHAVE de API (integrações), não a usuários da interface. Ficam catalogados
 * aqui para aparecerem no editor de permissões de chaves de API.
 */
export const API_NAMESPACES: readonly string[] = [
  "api:crm:ingest_lead",
  "api:contatos:criar",
];

/** Todos os namespaces conhecidos (núcleo + módulos + API externa). */
export const ALL_NAMESPACES: readonly string[] = [
  ...CORE_NAMESPACES,
  ...CRM_NAMESPACES,
  ...PROJETOS_NAMESPACES,
  ...API_NAMESPACES,
];
