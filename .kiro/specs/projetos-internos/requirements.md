# Requirements Document — Módulo de Projetos Internos

## Introduction

Esta especificação define o **Módulo de Projetos Internos** do HUB Central, o segundo módulo satélite da plataforma (após o CRM). Diferente do CRM — que trata de contatos/clientes externos —, este módulo é voltado exclusivamente aos **usuários do sistema** (colaboradores internos, provenientes do IAM em `core.users`). O objetivo é permitir que colaboradores participem de **projetos internos** organizados por uma interface **Kanban**, na qual as tarefas atribuídas são classificadas em três colunas **fixas**: "Não iniciadas", "Em execução" e "Finalizadas".

Cada projeto possui um **descritivo principal** (descrição detalhada e rica do projeto, distinta do campo curto de descrição) e pode receber **comentários no nível do projeto**. Cada tarefa (card) pode receber diversas anotações/comentários e ter arquivos anexados. Os anexos são armazenados em **disco local** do servidor e servidos pelo backend com controle de acesso; nesta versão os anexos existem **apenas em tarefas**, não no nível de projeto. Quando houver movimentação relevante em uma tarefa/projeto (mudança de coluna, novo comentário em tarefa, novo comentário no projeto, nova atribuição, alterações relevantes do projeto), os usuários envolvidos e o **Dono_Projeto** recebem **notificações in-app** por meio de uma **central de notificações do núcleo (core)**, genérica e reutilizável por qualquer módulo futuro.

O módulo segue o **Contrato de Módulos** do HUB Central: possui schema próprio no PostgreSQL (`mod_projetos`), referencia entidades do núcleo (`core.users`) **sem duplicar dados**, define permissões RBAC no namespace `projetos:recurso:acao`, grava auditoria imutável em `core.system_logs` (com `module = 'projetos'`) e publica eventos de negócio via **transactional outbox**. Esta especificação também inclui uma melhoria transversal de UX no frontend: o menu lateral passa a **agrupar os itens por módulo**.

## Glossary

- **Modulo_Projetos**: o novo módulo satélite, com schema próprio `mod_projetos` no PostgreSQL.
- **HUB_Central**: a plataforma/núcleo que provê IAM, RBAC, auditoria, eventos e serviços compartilhados.
- **Projeto**: iniciativa interna com dono e membros, contendo tarefas organizadas em Kanban. Em `mod_projetos.projects`.
- **Descritivo_Principal**: descrição detalhada e rica de um `Projeto`, distinta do campo curto de descrição, armazenada em `mod_projetos.projects`.
- **Usuario**: colaborador interno referenciado por `user_id` de `core.users` (IAM). Nenhum dado de usuário é duplicado em `mod_projetos`.
- **Dono_Projeto**: `Usuario` responsável pelo `Projeto`, com privilégios de gestão de membros e do próprio projeto.
- **Membro_Projeto**: `Usuario` associado a um `Projeto`, com acesso às tarefas do projeto.
- **Tarefa**: unidade de trabalho (card) pertencente a um `Projeto`. Em `mod_projetos.tasks`.
- **Coluna_Kanban**: um dos três estados fixos de uma `Tarefa`: `nao_iniciada`, `em_execucao`, `finalizada`.
- **Atribuicao**: vínculo N:N entre uma `Tarefa` e um ou mais `Usuario` responsáveis por executá-la.
- **Comentario**: anotação textual autorada por um `Usuario`, associada a uma `Tarefa` (em `mod_projetos.task_comments`) ou a um `Projeto` (em `mod_projetos.project_comments`).
- **Anexo**: arquivo vinculado a uma `Tarefa`, armazenado em disco local do servidor. Metadados em `mod_projetos.task_attachments`.
- **Central_Notificacoes**: serviço/tabela do núcleo (core) para notificações in-app, reutilizável por qualquer módulo. Em `core.notifications`.
- **Notificacao**: registro in-app entregue a um `Usuario` destinatário quando ocorre um evento relevante.
- **Diretorio_Uploads**: diretório de armazenamento de anexos em disco local do servidor (ex.: `/opt/hubcentral/uploads`).
- **RBAC**: controle de acesso por papéis, avaliado por namespaces no formato `modulo:recurso:acao`.
- **Outbox**: mecanismo de transactional outbox do núcleo que garante publicação confiável de eventos de negócio.

## Requirements

### Requirement 1: Projetos internos

**User Story:** Como colaborador interno, quero criar e gerir projetos internos, para organizar o trabalho da equipe por iniciativa.

#### Acceptance Criteria

1. WHEN um Projeto é criado, THE Modulo_Projetos SHALL registrar nome, descrição, Descritivo_Principal, um Dono_Projeto referenciado por `user_id` de `core.users` e o estado inicial `ativo`.
2. THE Modulo_Projetos SHALL referenciar o Dono_Projeto e os membros por `user_id` do IAM, sem duplicar dados de usuário em `mod_projetos`.
3. WHEN um Projeto é editado, THE Modulo_Projetos SHALL permitir alterar nome, descrição, Descritivo_Principal e Dono_Projeto por usuários com o namespace `projetos:projeto:editar`.
4. WHEN um Projeto é arquivado, THE Modulo_Projetos SHALL marcar o Projeto como `arquivado` e preservar suas tarefas, comentários e anexos para consulta somente-leitura.
5. WHILE um Projeto está `arquivado`, THE Modulo_Projetos SHALL impedir a criação e a movimentação de tarefas nesse Projeto.
6. WHEN um Projeto é criado, editado ou arquivado, THE HUB_Central SHALL gravar auditoria em `core.system_logs` com `module = 'projetos'`.
7. WHEN a listagem de projetos é consultada, THE Modulo_Projetos SHALL retornar somente os Projetos em que o Usuario autenticado é Dono_Projeto ou Membro_Projeto.
8. WHERE um Usuario não é Dono_Projeto nem Membro_Projeto de um Projeto, THE Modulo_Projetos SHALL negar o acesso ao detalhe desse Projeto e ocultar sua existência (listagem e detalhe).
9. IF um Usuario possui o namespace `projetos:projeto:visualizar` mas não é Dono_Projeto nem Membro_Projeto de um Projeto, THEN THE Modulo_Projetos SHALL ainda assim negar o acesso a esse Projeto — o namespace por si só não concede acesso a projetos dos quais o Usuario não participa.

### Requirement 2: Gestão de membros do projeto

**User Story:** Como Dono_Projeto, quero gerenciar os membros do projeto, para controlar quem participa e acessa as tarefas.

#### Acceptance Criteria

1. THE Modulo_Projetos SHALL permitir associar um ou mais Membro_Projeto a um Projeto, cada um referenciado por `user_id` de `core.users`.
2. WHEN um Usuario é adicionado ou removido como Membro_Projeto, THE Modulo_Projetos SHALL exigir o namespace `projetos:membros:gerenciar` do executor.
3. WHERE um Usuario não é Dono_Projeto nem Membro_Projeto de um Projeto, THE Modulo_Projetos SHALL negar o acesso ao próprio Projeto (listagem e detalhe) e a todos os seus dados relacionados — tarefas, comentários e anexos.
4. WHEN um Membro_Projeto é adicionado a um Projeto, THE HUB_Central SHALL gravar auditoria em `core.system_logs` com `module = 'projetos'`.
5. IF um Usuario é removido de um Projeto enquanto possui tarefas atribuídas, THEN THE Modulo_Projetos SHALL manter as tarefas e remover a Atribuicao correspondente desse Usuario.

### Requirement 3: Tarefas em Kanban com três colunas fixas

**User Story:** Como Membro_Projeto, quero visualizar e organizar as tarefas em um Kanban de três colunas, para acompanhar o andamento do trabalho.

#### Acceptance Criteria

1. THE Modulo_Projetos SHALL exibir as Tarefas de um Projeto em um Kanban com exatamente três Coluna_Kanban fixas: "Não iniciadas" (`nao_iniciada`), "Em execução" (`em_execucao`) e "Finalizadas" (`finalizada`).
2. THE Modulo_Projetos SHALL impedir a criação, remoção ou renomeação de Coluna_Kanban, mantendo o conjunto de três colunas fixo em todos os projetos.
3. WHEN uma Tarefa é criada, THE Modulo_Projetos SHALL registrar título, descrição, o Projeto ao qual pertence e a Coluna_Kanban inicial `nao_iniciada`.
4. WHEN uma Tarefa é criada por um usuário com o namespace `projetos:tarefa:criar`, THE Modulo_Projetos SHALL associá-la ao Projeto informado.
5. WHERE o usuário não possui o namespace `projetos:tarefa:visualizar` para o Projeto, THE Modulo_Projetos SHALL ocultar as tarefas do Projeto.

### Requirement 4: Movimentação de tarefas entre colunas

**User Story:** Como Membro_Projeto, quero mover uma tarefa entre as colunas por arrastar-e-soltar, para atualizar o status do trabalho.

#### Acceptance Criteria

1. WHEN uma Tarefa é movida entre Coluna_Kanban, THE Modulo_Projetos SHALL atualizar o estado da Tarefa para a coluna de destino.
2. WHEN uma Tarefa é movida, THE Modulo_Projetos SHALL exigir o namespace `projetos:tarefa:mover` do executor.
3. WHERE o usuário não possui o namespace `projetos:tarefa:mover`, THE Modulo_Projetos SHALL desabilitar o arrastar-e-soltar da Tarefa.
4. WHEN uma Tarefa é movida entre Coluna_Kanban, THE HUB_Central SHALL gravar auditoria em `core.system_logs` com `module = 'projetos'` e publicar o evento `projetos.tarefa.movida` via Outbox.
5. WHEN o evento `projetos.tarefa.movida` é publicado, THE HUB_Central SHALL gerar uma Notificacao in-app para cada Usuario envolvido na Tarefa e para o Dono_Projeto, exceto o autor da movimentação.

### Requirement 5: Atribuição de tarefas

**User Story:** Como Membro_Projeto, quero atribuir tarefas a um ou mais usuários, para deixar clara a responsabilidade pela execução.

#### Acceptance Criteria

1. THE Modulo_Projetos SHALL permitir atribuir uma Tarefa a um ou mais Usuario, cada um referenciado por `user_id` de `core.users`.
2. WHEN uma Atribuicao é criada ou removida, THE Modulo_Projetos SHALL exigir o namespace `projetos:tarefa:atribuir` do executor.
3. THE Modulo_Projetos SHALL restringir a Atribuicao a Usuarios que sejam Dono_Projeto ou Membro_Projeto do Projeto da Tarefa.
4. WHEN um Usuario recebe uma nova Atribuicao, THE HUB_Central SHALL publicar o evento `projetos.tarefa.atribuida` via Outbox e gerar uma Notificacao in-app para o Usuario atribuído e para o Dono_Projeto, exceto quando o Dono_Projeto for o autor da Atribuicao.
5. WHEN uma Atribuicao é criada ou removida, THE HUB_Central SHALL gravar auditoria em `core.system_logs` com `module = 'projetos'`.

### Requirement 6: Comentários e anotações em tarefas

**User Story:** Como Membro_Projeto, quero registrar comentários e anotações em uma tarefa, para documentar o andamento e comunicar os envolvidos.

#### Acceptance Criteria

1. THE Modulo_Projetos SHALL permitir que uma Tarefa receba diversos Comentario, cada um com autor (`user_id`), texto e timestamp.
2. WHEN um Comentario é criado, THE Modulo_Projetos SHALL exigir o namespace `projetos:comentario:criar` do autor.
3. THE Modulo_Projetos SHALL exibir os Comentario de uma Tarefa em ordem cronológica.
4. WHEN um Comentario de Tarefa é criado, THE HUB_Central SHALL publicar o evento `projetos.comentario.criado` via Outbox e gerar uma Notificacao in-app para cada Usuario envolvido na Tarefa e para o Dono_Projeto, exceto o autor do Comentario.
5. WHEN um Comentario é criado, THE HUB_Central SHALL gravar auditoria em `core.system_logs` com `module = 'projetos'`.

### Requirement 7: Anexos de arquivo em disco local

**User Story:** Como Membro_Projeto, quero anexar arquivos a uma tarefa, para compartilhar documentos relacionados ao trabalho.

#### Acceptance Criteria

1. WHEN um Anexo é enviado, THE Modulo_Projetos SHALL armazenar o arquivo no Diretorio_Uploads em disco local do servidor e registrar seus metadados (nome original, tamanho, tipo, autor e Tarefa) em `mod_projetos.task_attachments`.
2. WHEN um Anexo é enviado, THE Modulo_Projetos SHALL exigir o namespace `projetos:anexo:enviar` do executor.
3. WHEN um Anexo é recebido, THE Modulo_Projetos SHALL validar o tamanho e o tipo do arquivo contra os limites configurados e gerar um nome de armazenamento seguro que impeça travessia de diretório.
4. IF um Anexo excede o limite de tamanho ou possui tipo não permitido, THEN THE Modulo_Projetos SHALL rejeitar o envio e retornar um erro descritivo sem persistir o arquivo.
5. WHEN um Anexo é baixado, THE Modulo_Projetos SHALL exigir o namespace `projetos:anexo:baixar` e restringir o download a Dono_Projeto ou Membro_Projeto do Projeto da Tarefa.
6. WHEN um Anexo é excluído, THE Modulo_Projetos SHALL exigir o namespace `projetos:anexo:excluir`, remover o arquivo do Diretorio_Uploads e registrar auditoria em `core.system_logs` com `module = 'projetos'`.
7. THE HUB_Central SHALL criar o Diretorio_Uploads no instalador Linux e incluí-lo na rotina de backup.

### Requirement 8: Central de notificações in-app do núcleo

**User Story:** Como usuário do sistema, quero ver notificações in-app quando houver movimentação relevante nas minhas tarefas/projetos, para acompanhar o que precisa da minha atenção.

#### Acceptance Criteria

1. THE HUB_Central SHALL prover uma Central_Notificacoes no núcleo (`core.notifications`) reutilizável por qualquer módulo, com campos destinatário (`user_id`), módulo de origem, tipo, mensagem, entidade/link referenciado, estado de leitura (`lida`/`nao_lida`) e timestamp.
2. WHEN um módulo publica um evento relevante para um Usuario, THE HUB_Central SHALL registrar uma Notificacao para o destinatário na Central_Notificacoes.
3. THE HUB_Central SHALL exibir, no topo do HUB Central, um ícone de sino com um contador das Notificacao não lidas do Usuario autenticado.
4. WHEN um Usuario marca uma Notificacao como lida, THE HUB_Central SHALL atualizar seu estado para `lida` e decrementar o contador de não lidas.
5. WHEN um Usuario acessa a Central_Notificacoes, THE HUB_Central SHALL exigir o namespace `projetos:notificacoes:visualizar` para as notificações de origem do Modulo_Projetos.
6. THE HUB_Central SHALL entregar as Notificacao somente in-app nesta versão, sem envio por e-mail.

### Requirement 9: Permissões RBAC do módulo

**User Story:** Como administrador, quero permissões RBAC granulares para o módulo de projetos, para controlar o que cada papel pode fazer.

#### Acceptance Criteria

1. THE Modulo_Projetos SHALL declarar os namespaces `projetos:projeto:visualizar`, `projetos:projeto:criar`, `projetos:projeto:editar`, `projetos:projeto:arquivar`, `projetos:membros:gerenciar`, `projetos:tarefa:visualizar`, `projetos:tarefa:criar`, `projetos:tarefa:editar`, `projetos:tarefa:mover`, `projetos:tarefa:atribuir`, `projetos:comentario:criar`, `projetos:anexo:enviar`, `projetos:anexo:baixar`, `projetos:anexo:excluir` e `projetos:notificacoes:visualizar`.
2. WHEN uma ação do Modulo_Projetos é solicitada, THE HUB_Central SHALL avaliar o namespace correspondente pelo RBAC antes de executar a ação.
3. IF o Usuario não possui o namespace exigido para uma ação, THEN THE HUB_Central SHALL negar a ação e retornar um erro de autorização.
4. WHEN o Modulo_Projetos é provisionado no bootstrap, THE HUB_Central SHALL conceder todos os namespaces `projetos:*` ao papel SuperAdministrador.
5. THE Modulo_Projetos SHALL requerer reconcessão explícita dos novos namespaces `projetos:*` aos papéis e usuários existentes como consideração operacional pós-implantação.
6. THE Modulo_Projetos SHALL utilizar o namespace `projetos:comentario:criar` tanto para Comentario de Tarefa quanto para Comentario de Projeto.

### Requirement 10: Auditoria e eventos do módulo

**User Story:** Como responsável pela plataforma, quero que todas as movimentações relevantes gerem auditoria e eventos, para garantir rastreabilidade e integração assíncrona.

#### Acceptance Criteria

1. WHEN um Projeto, uma Tarefa, uma Atribuicao, um Comentario de Tarefa, um Comentario de Projeto ou um Anexo é criado, editado, movido ou removido, THE HUB_Central SHALL gravar auditoria imutável em `core.system_logs` com `module = 'projetos'`.
2. WHEN uma movimentação relevante ocorre, THE HUB_Central SHALL publicar o evento correspondente (`projetos.tarefa.movida`, `projetos.tarefa.atribuida`, `projetos.comentario.criado`, `projetos.projeto.comentario.criado`) via transactional outbox na mesma transação do dado de negócio.
3. WHEN um evento do Modulo_Projetos é consumido, THE HUB_Central SHALL alimentar a Central_Notificacoes com as Notificacao dos Usuarios envolvidos.
4. THE Modulo_Projetos SHALL manter seus dados no schema `mod_projetos`, referenciando `core.users` sem duplicar dados de usuário.

### Requirement 11: Menu lateral agrupado por módulo

**User Story:** Como usuário do sistema, quero que o menu lateral agrupe os itens por módulo, para navegar entre os módulos com mais clareza.

#### Acceptance Criteria

1. THE HUB_Central SHALL agrupar os itens do menu lateral por módulo, exibindo um cabeçalho/seção por módulo (ex.: "CRM", "Projetos Internos", "Administração"), em vez de uma lista plana.
2. WHEN um módulo registra itens de menu no registro de módulos do frontend, THE HUB_Central SHALL exibi-los sob a seção do módulo correspondente.
3. WHERE o Usuario não possui permissão para nenhum item de um módulo, THE HUB_Central SHALL ocultar a seção do módulo no menu lateral.
4. THE HUB_Central SHALL aplicar o agrupamento por módulo a todos os módulos registrados, de forma consistente.

### Requirement 12: Comentários no nível do projeto

**User Story:** Como Membro_Projeto ou Dono_Projeto, quero registrar comentários no nível do projeto, para documentar decisões e comunicar os envolvidos sobre o projeto como um todo.

#### Acceptance Criteria

1. THE Modulo_Projetos SHALL permitir que um Projeto receba diversos Comentario, cada um com autor (`user_id`), texto e timestamp, persistidos em `mod_projetos.project_comments`.
2. WHEN um Comentario de Projeto é criado, THE Modulo_Projetos SHALL exigir o namespace `projetos:comentario:criar` do autor.
3. THE Modulo_Projetos SHALL exibir os Comentario de um Projeto em ordem cronológica.
4. WHEN um Comentario de Projeto é criado, THE HUB_Central SHALL publicar o evento `projetos.projeto.comentario.criado` via Outbox e gerar uma Notificacao in-app para o Dono_Projeto e para cada Membro_Projeto, exceto o autor do Comentario.
5. WHEN um Comentario de Projeto é criado, THE HUB_Central SHALL gravar auditoria em `core.system_logs` com `module = 'projetos'`.

### Requirement 13: Central de Configurações do sistema (núcleo)

**User Story:** Como administrador, quero uma central de configurações do HUB Central onde cada módulo expõe seus parâmetros, para ajustar o comportamento dos módulos sem alterar variáveis de ambiente ou reimplantar.

#### Acceptance Criteria

1. THE HUB_Central SHALL prover uma Central_Configuracoes no núcleo (`core.settings`) reutilizável por qualquer módulo, armazenando parâmetros por módulo (chave/valor com tipo e metadados de exibição).
2. WHEN a Central_Configuracoes é consultada, THE HUB_Central SHALL agrupar os parâmetros por módulo de origem (ex.: "Projetos Internos", "CRM").
3. WHEN um administrador altera um parâmetro, THE HUB_Central SHALL persistir o novo valor e passar a aplicá-lo sem necessidade de reimplantação, gravando auditoria em `core.system_logs`.
4. WHERE um parâmetro não possui valor definido na Central_Configuracoes, THE HUB_Central SHALL utilizar o valor padrão (default), incluindo, quando aplicável, o valor de variável de ambiente como fallback inicial.
5. THE HUB_Central SHALL exigir um namespace administrativo para visualizar e editar as configurações (ex.: `core:config:gerenciar`).
6. THE Modulo_Projetos SHALL expor na Central_Configuracoes os parâmetros de anexo — tamanho máximo de arquivo e tipos/extensões permitidos — e SHALL aplicá-los na validação de envio de Anexo, prevalecendo sobre os defaults de ambiente.

## Out of Scope (Não-objetivos da v1)

Os itens abaixo estão explicitamente **fora do escopo** desta versão e não devem ser implementados como parte desta spec:

- **Notificações por e-mail**: nesta versão as notificações são somente in-app; o envio por e-mail (SMTP) permanece como pendência da plataforma.
- **Subtarefas**: tarefas não terão hierarquia de subtarefas.
- **Dependências entre tarefas**: não haverá relação de precedência/bloqueio entre tarefas.
- **Prazos com alerta automático agendado**: não haverá agendamento de alertas por vencimento de prazo.
- **Relatórios e dashboards**: não haverá painéis analíticos ou relatórios do módulo.
- **Colunas configuráveis**: o Kanban terá exatamente três colunas fixas, não configuráveis por projeto.
- **Controle de tempo / timesheet**: não haverá registro de horas ou apontamento de tempo por tarefa.
