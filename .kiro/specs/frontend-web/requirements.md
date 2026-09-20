# Requirements Document — Frontend Web

## Introduction

Este documento especifica o **frontend web** do HUB Central: uma SPA (Single Page Application) que consome a API do núcleo e dos módulos, oferecendo o portal operacional unificado. O objetivo não é uma tela provisória, mas uma **fundação consolidada e extensível**: adicionar um novo módulo à interface deve ser plugar um registro declarativo, do mesmo modo que o Contrato de Módulos permite acoplar módulos ao backend.

A interface segue **Google Material Design** e suporta **branding white-label** (logotipo, paleta de cores) configurável, conforme a arquitetura central (§4.3). A autenticação é delegada ao IAM (login por token de sessão), e a visibilidade de menus/ações respeita o RBAC.

O primeiro módulo com telas é o **CRM**, começando pelo pipeline Kanban.

## Glossary

- **Frontend**: aplicação SPA do HUB Central executada no navegador.
- **Shell**: casca da aplicação (cabeçalho, barra lateral, área de conteúdo, tema) comum a todos os módulos.
- **Modulo_Frontend**: unidade que registra rotas, itens de menu e permissões de uma área funcional (ex.: CRM).
- **Registro_Modulos**: coleção declarativa de Modulo_Frontend carregada pelo Shell para compor navegação e rotas.
- **Sessao**: token de autenticação e dados do usuário logado, obtidos no login via IAM.
- **Branding**: configuração visual white-label (logotipo, paleta de cores, nome do sistema).
- **RBAC_Namespace**: permissão no formato `[modulo]:[recurso]:[acao]`, usada para exibir/ocultar navegação e ações.
- **Cliente_API**: camada tipada que faz as requisições HTTP à API do HUB Central.

## Requirements

### Requirement 1: Autenticação e sessão

**User Story:** Como usuário, quero entrar no sistema com e-mail e senha, para acessar as áreas que me são permitidas.

#### Acceptance Criteria

1. WHEN o usuário submete e-mail e senha válidos, THE Frontend SHALL autenticar via `/api/auth/login` e armazenar a Sessao (token).
2. IF as credenciais são inválidas, THEN THE Frontend SHALL exibir mensagem de erro sem revelar qual campo falhou.
3. WHEN o login retorna `must_change_password = true`, THE Frontend SHALL redirecionar para a tela de definição de nova senha antes de permitir o uso do sistema.
4. WHILE não há Sessao válida, THE Frontend SHALL redirecionar qualquer rota protegida para a tela de login.
5. WHEN o usuário aciona sair (logout), THE Frontend SHALL revogar a sessão via `/api/auth/logout` e limpar o token local.
6. IF uma requisição à API retorna 401, THEN THE Frontend SHALL encerrar a Sessao local e redirecionar para o login.
7. THE Frontend SHALL enviar o token da Sessao no cabeçalho `Authorization: Bearer <token>` em todas as requisições autenticadas.

### Requirement 2: Shell e navegação por registro de módulos

**User Story:** Como desenvolvedor, quero registrar um módulo de forma declarativa, para que suas telas e menus apareçam sem alterar o Shell.

#### Acceptance Criteria

1. THE Frontend SHALL montar a navegação e as rotas a partir do Registro_Modulos, sem código específico de módulo no Shell.
2. WHEN um Modulo_Frontend é adicionado ao Registro_Modulos, THE Frontend SHALL exibir seus itens de menu e habilitar suas rotas automaticamente.
3. WHERE um item de menu ou rota declara um RBAC_Namespace exigido, THE Frontend SHALL exibi-lo somente se o usuário possui a permissão.
4. THE Shell SHALL apresentar cabeçalho, barra lateral de navegação e área de conteúdo em layout Material Design responsivo.
5. IF o usuário acessa uma rota para a qual não tem permissão, THEN THE Frontend SHALL exibir uma página de acesso negado.

### Requirement 3: Branding white-label

**User Story:** Como SuperAdministrador, quero personalizar a identidade visual, para que o portal reflita a marca da empresa.

#### Acceptance Criteria

1. THE Frontend SHALL aplicar o Branding (logotipo, paleta de cores primária/secundária, nome do sistema) via um provedor de tema Material.
2. WHEN o Branding é alterado, THE Frontend SHALL refletir as cores e o logotipo sem exigir recompilação.
3. WHERE nenhum Branding customizado está definido, THE Frontend SHALL aplicar um tema padrão do HUB Central.
4. THE Frontend SHALL exibir o logotipo configurado na tela de login e no cabeçalho.

### Requirement 4: Cliente de API tipado

**User Story:** Como desenvolvedor, quero um cliente de API tipado, para consumir os endpoints com segurança de tipos e tratamento de erro consistente.

#### Acceptance Criteria

1. THE Cliente_API SHALL expor funções tipadas para os endpoints de auth, contatos, segmentos e CRM.
2. WHEN a API retorna um erro no formato `{ code, message, details }`, THE Cliente_API SHALL propagar esse formato para tratamento na interface.
3. THE Cliente_API SHALL anexar o token da Sessao automaticamente às requisições autenticadas.
4. THE Frontend SHALL usar cache e sincronização de estado de servidor (invalidação após mutações) para os dados carregados da API.

### Requirement 5: Módulo CRM — Pipeline Kanban

**User Story:** Como usuário do CRM, quero visualizar e mover leads no pipeline, para gerir o funil de vendas visualmente.

#### Acceptance Criteria

1. THE Modulo_Frontend CRM SHALL exibir o pipeline como colunas Kanban correspondentes às etapas.
2. WHEN o usuário move um lead entre colunas, THE Frontend SHALL chamar `/api/crm/leads/:id/move` e refletir a nova etapa.
3. WHEN o usuário abre um lead, THE Frontend SHALL exibir os dados de contato obtidos da Base Central e a timeline do lead.
4. WHERE o usuário não possui `crm:pipeline:mover`, THE Frontend SHALL desabilitar o arrastar-e-soltar.
5. WHEN um lead é criado pela interface, THE Frontend SHALL chamar `/api/crm/leads` e exibir o lead na coluna inicial.

### Requirement 6: Empacotamento e entrega

**User Story:** Como operador de implantação, quero servir o frontend junto do backend, para que o portal fique acessível via web com HTTPS.

#### Acceptance Criteria

1. THE Frontend SHALL ser compilado em artefatos estáticos servíveis por um servidor web.
2. THE entrega SHALL servir a SPA e encaminhar as chamadas `/api/*` para o backend via reverse proxy.
3. WHEN uma rota de aplicação é acessada diretamente, THE servidor web SHALL retornar o index da SPA (fallback de SPA).
4. THE instalador SHALL compilar e publicar o frontend e configurar o servidor web na implantação Linux.
