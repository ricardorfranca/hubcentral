# Changelog

Todas as mudanças relevantes deste projeto são documentadas aqui. O formato segue o versionamento semântico (SemVer).

## [0.9.1] - 2026-09-20

### Adicionado

- **WhatsApp por usuário (Evolution API)**: cada usuário configura seu próprio canal (URL base, instância e API key) em "Minha conta → Meu canal de WhatsApp"; o superadministrador pode inserir/editar as credenciais de qualquer usuário. Valores globais servem de fallback. Envio de mensagens a partir do cadastro de contatos e teste de conexão da instância.
- **Telefonia / discagem via PABX**: campo **Ramal** por usuário e comando **curl** de discagem configurável (Configurações → Telefonia/PABX) com variáveis do sistema (`{{ramal}}`, `{{telefone}}`, `{{telefone_e164}}`, `{{usuario}}`, `{{contato}}`). Botão "Ligar" no contato solicita a chamada ao PABX remoto para o ramal do usuário.
- **Botões de ação no contato**: WhatsApp, Ligar e SMS diretamente no cadastro, usando o telefone do contato.
- **Campos personalizados de contatos (UI)**: gestão de definições tipadas (texto/número/sim-não/data) em Administração → Campos personalizados e edição dos valores por contato, para enriquecer os cadastros (ex.: escola dos filhos).
- **Campanhas — agendamento e ritmo**: disparo automático após o cadastro, com "mensagens por vez" e "máximo por hora" (worker de disparo controlado). Seletor de variáveis do contato/lead (nome, empresa, e-mail, telefone, vendedor, produto e campos personalizados) para corpo e assunto. WhatsApp adicionado como canal de disparo.

### Alterado

- **Configurações gerais reorganizadas** por seções temáticas (Identidade visual, E-mail/SMTP, SMS, WhatsApp/Evolution, Telefonia/PABX) para não misturar áreas.

### Corrigido

- **Modo escuro na tela de Oportunidades**: colunas do Kanban e cartões passam a usar tokens do tema (`background.default`/`background.paper` + `text.primary`), corrigindo o fundo claro com texto claro por cima que deixava o texto dos cartões invisível.

## [0.9.0] - 2026-09-20

### Adicionado

- **Tela de Contatos** (Base Central): gestão de pessoas e empresas (leads ou não) num único lugar, com busca, rótulos (labels) aplicáveis inline e criação. É a fundação já existente (`core.contacts`) agora com interface própria, referenciada por CRM, Projetos e campanhas.
- **Autofill de CNPJ**: no cadastro de empresa (Contatos e CRM), o CNPJ é o primeiro campo; ao preenchê-lo, os dados oficiais (razão social) são buscados na BrasilAPI e pré-preenchidos, permanecendo editáveis. Degrada com elegância sem internet.
- **Telefone padronizado (Brasil)**: campo com prefixo fixo `+55`, bandeira do Brasil e máscara DDD + número, armazenando em E.164. Aplicado no cadastro de pessoas.
- **SMS multicanal**: dois gateways configuráveis — **Clickatell** (API na nuvem) e **GoIP** (gateway GSM local) — com teste de conexão/envio. O canal SMS de campanha passa a enviar de verdade quando configurado.
- **Editor de campanhas** reformulado: nome, segmentação por etiquetas (chips), canais Email/WhatsApp/SMS, status (Rascunho/Ativa/Pausada), assunto, formato do conteúdo (texto/HTML) e corpo com variáveis (`{{nome_lead}}`). Edição e disparo com retorno de entregues/falhas.

### Alterado

- Menu do CRM: **"Contas" renomeado para "Empresas"**.
- Disparo de campanha por Email/SMS passa a usar o serviço central de e-mail/SMS (best-effort por contato).

### Operação

- Variáveis de SMS opcionais (`SMS_*`) como fallback; preferencialmente configure pela Central de Configurações.
- O autofill de CNPJ faz uma chamada de saída à BrasilAPI a partir do servidor.

## [0.8.0] - 2026-09-20

### Adicionado — Plataforma

- **Modo escuro**: alternância de tema (claro/escuro) no topo do portal, com preferência salva por usuário.
- **Identidade visual configurável**: nome do sistema, logotipo (upload ou URL) e cores (primária/secundária) editáveis em Administração → Configurações; aplicados a todo o portal. Novo ícone do sistema.
- **Conta de e-mail (SMTP)**: configuração de servidor de saída (host, porta com padrões 587/465, usuário, senha, remetente) com **teste de conexão** e envio de e-mail de teste. Base para todos os envios do sistema; o convite de usuário passa a enviar e-mail quando o SMTP está configurado.
- **Backup e restauração** (SuperAdministrador): geração de um pacote com banco de dados e anexos para download, e restauração a partir do pacote, com confirmação forte na interface.

### Adicionado — Projetos Internos 2.0

- **Prazos**: prazo total do projeto e prazo por tarefa (limitado à data do projeto).
- **Dependências entre tarefas**: uma tarefa pode depender de outra; só é possível iniciá-la após a dependência ser finalizada.
- **Gráfico de Gantt** por projeto, além do Kanban.
- **Sinalização de prazo no card**: vermelho suave para tarefas atrasadas e amarelo quando faltam poucos dias (limite configurável por tarefa ou projeto; padrão de 2 dias).
- **Responsável único** por tarefa; todos os participantes podem visualizar e comentar. O dono do projeto pode restringir a visibilidade de tarefas específicas (padrão: visível a todos).
- **Apontamento de tempo** por comentário (horas/minutos), com somatório no card da tarefa e total no projeto.
- **Recursos e custos**: valor/hora do projeto (estimativa de custo de mão de obra a partir das horas) e custos diversos em R$.
- **Anotação automática** ao mover um card entre colunas, registrando quem moveu.
- **Desarquivar projeto**: permitido a SuperAdministradores e ao dono do projeto.
- **Relatório executivo em PDF** do projeto (SuperAdministrador ou dono).
- **Dashboard do SuperAdministrador** com quantitativos, horas e custos por projeto e totais.

### Alterado

- Anexos passam a ser exibidos em **MB**; o limite de tamanho é configurável (em MB) na Central de Configurações.
- CRM: itens de listas configuráveis (etiquetas, origens etc.) podem ser **removidos**.
- Usuários: o administrador pode **definir a senha** de um usuário diretamente na tela de Usuários.

### Operação

- Novas variáveis de ambiente opcionais de SMTP (`SMTP_*`) como fallback; preferencialmente configure pela Central de Configurações.
- Backup/restore requerem `pg_dump`/`pg_restore` no servidor (pacote postgresql-client, já presente na implantação).
- Novo namespace `core:backup:gerenciar` concedido ao SuperAdministrador; reaplicar via `scripts/reset-admin.sh` em ambientes existentes.

## [0.7.0] - 2026-09-20

### Adicionado — Módulo de Projetos Internos

Novo módulo satélite (`mod_projetos`) para os usuários do sistema (colaboradores internos), com quadro Kanban, comentários e anexos, além de duas capacidades transversais no núcleo.

- **Projetos internos**: criação/edição/arquivamento, com dono e membros referenciando o IAM (`core.users`), descrição curta e um descritivo principal. O acesso é restrito a dono e membros — quem não participa não vê o projeto (nem na listagem, nem no detalhe).
- **Kanban de tarefas**: três colunas fixas (Não iniciadas, Em execução, Finalizadas). Cartões movidos por arrastar-e-soltar; criação e edição de tarefas.
- **Atribuição**: tarefas atribuíveis a um ou mais membros do projeto.
- **Comentários**: no nível da tarefa e no nível do projeto, em ordem cronológica.
- **Anexos**: arquivos por tarefa, armazenados em disco local do servidor, com nome de armazenamento seguro, validação de tamanho/tipo e download autenticado com verificação de acesso.
- Permissões RBAC `projetos:*` (bootstrap concede ao SuperAdministrador).

### Adicionado — Núcleo

- **Central de Notificações in-app** (`core.notifications`): serviço genérico reutilizável por qualquer módulo. Sino com contador de não lidas no topo do portal; clicar em uma notificação abre a entidade e a marca como lida. As movimentações em Projetos (mover tarefa, atribuir, comentar) notificam os envolvidos e o dono do projeto. Somente in-app nesta versão.
- **Central de Configurações** (`core.settings`): parâmetros por módulo, editáveis no portal (Administração → Configurações), agrupados por módulo. Resolução de valor: persistido → default → variável de ambiente. Os limites de anexo do módulo de Projetos são configuráveis por aqui.
- **Menu lateral agrupado por módulo**: o portal passa a exibir um cabeçalho por módulo (CRM, Projetos Internos, Administração), ocultando seções sem permissão.

### Operação

- Novas variáveis de ambiente `UPLOADS_DIR`, `UPLOADS_MAX_BYTES`, `UPLOADS_ALLOWED` (fallback inicial dos limites de anexo). O instalador cria o diretório de uploads sob `/opt/hubcentral/uploads`; inclua-o na rotina de backup.
- Novos namespaces (`projetos:*` e `core:config:gerenciar`) são concedidos ao SuperAdministrador ao rodar `scripts/reset-admin.sh`; usuários/perfis existentes precisam de reconcessão.

## [0.6.0] - 2026-09-20

### Adicionado — CRM 2.0 (Receita Previsível, B2B)

Reformulação do CRM para o modelo de **Receita Previsível**, com foco em vendas B2B recorrentes. A conta (empresa) é permanente — a fonte de verdade é a Base Central de Contatos (`core.contacts`) — enquanto a oportunidade é efêmera e repetível ao longo do relacionamento.

- **Contas (empresas)**: cadastro a partir de razão social + CNPJ, com segmento e porte. Vinculam contatos (pessoas) da Base Central e acumulam o histórico de oportunidades. Novas permissões `crm:contas:visualizar|criar|editar`.
- **Oportunidades**: separadas do conceito de lead. Toda oportunidade pertence a uma conta e captura **MRR (recorrente)** + **valor único (setup)**; o ARR é derivado (`MRR × 12`). Origem (inbound/outbound/indicação), qualificação (frio/morno/quente) e estágio configurável. Kanban por estágio com mover por arrastar, detalhe com finalização (ganho exige valores; perdido exige motivo). Permissões `crm:oportunidades:visualizar|criar|editar|mover|finalizar`.
- **Pipeline configurável**: estágios persistidos no banco (novo, qualificação, descoberta, proposta, negociação, ganho, perdido) com probabilidade por estágio, editáveis.
- **Atividades (cadência de vendas)**: ligações, e-mails, reuniões, tarefas e notas, com prazo e conclusão, vinculadas a oportunidade/conta/contato. Agenda pessoal do usuário. Permissões `crm:atividades:visualizar|gerenciar`.
- **Dashboards de Receita Previsível**: forecast ponderado (Σ do valor anualizado × probabilidade), novo MRR/ARR do período, e pipeline por estágio, origem e responsável. Permissão `crm:forecast:visualizar`.
- **Conversas**: tela reescrita para listar as conversas do usuário (equipe + DMs) com contagem de não lidas e marcação de leitura ao abrir.

### Alterado

- Migração dos leads existentes para o novo modelo de oportunidades/contas, preservando o histórico.
- Telas antigas baseadas em lead (Kanban, detalhe, criação) substituídas pelas telas de oportunidade/conta. Configurações de SLA passam a usar os estágios reais do pipeline.

## [0.5.1] - 2026-09-20

### Corrigido

- **Leads não apareciam no pipeline após criados**: a rota de listagem `GET /api/crm/leads` não existia (só havia a de um lead específico), então o Kanban recebia erro e ficava vazio. Adicionados o serviço `listLeads` e a rota, que retornam os leads com o nome do contato resolvido da Base Central. O card do Kanban passa a exibir o nome da pessoa (e da empresa, quando houver).

### Adicionado

- **Script `scripts/reset-admin.sh`**: redefine (ou cria) o SuperAdministrador de forma simples no servidor, encapsulando o carregamento do `.env` e o CLI idempotente. Documentado no README.

## [0.5.0] - 2026-09-19

### Alterado

- **Frontend pré-compilado na release**: um workflow do GitHub Actions compila o frontend a cada tag e anexa `frontend-dist.tar.gz` à release. O instalador passa a **baixar o artefato pronto** em vez de compilar no servidor — resolve falhas de memória (OOM) em VMs pequenas (ex.: 1 GB). Se o artefato não estiver disponível, o instalador cai para o build local.
- **Swap temporário no instalador**: em máquinas com pouca RAM e sem swap, o instalador ativa um swap temporário de 2 GB durante o build do backend e o remove ao final.

### Adicionado

- Workflow de **CI** (typecheck, testes e build de backend e frontend) em push/PR para `main`.

## [0.4.3] - 2026-09-19

### Corrigido

- **Atualização robusta no instalador**: a sincronização do código deixou de depender de `pull --ff-only` (que falhava se o repositório local divergisse) e passou a usar `fetch` + `reset --hard origin/<ref>`, com fallback para re-clonagem limpa (preservando o `.env`). Resolve casos em que o diretório de deploy fica num estado que impede a atualização.

## [0.4.2] - 2026-09-19

### Corrigido

- **Atualização via instalador em `/opt/hubcentral`**: o `git pull` falhava com "detected dubious ownership" ao atualizar, porque o repositório pertence ao usuário `hubcentral` e o instalador roda como root (proteção CVE-2022-24765 do Git). O `install.sh` passa a marcar o diretório como `safe.directory` para o root (idempotente) antes das operações git.

## [0.4.1] - 2026-09-19

### Corrigido

- **Round-trip de CSV**: uma linha de dados composta apenas por campos vazios (ex.: uma única coluna com valor vazio) era perdida ao serializar/parsear CSV. O `toCsv` passou a terminar todas as linhas com CRLF e o parser distingue "linha vazia final" de "ausência de linha". Isso era a causa de uma falha intermitente na suíte de testes de propriedade (import/export). Adicionados testes determinísticos de casos de borda de CSV.
- **Higiene dos testes de eventos**: os testes do barramento/worker deixaram de depender de um `core.event_outbox` globalmente vazio, verificando apenas as próprias linhas (por id/contact_id).

## [0.4.0] - 2026-09-19

### Adicionado

- **Gestão de usuários (backend)**: rotas `/api/iam/users` (listar, convidar, reenviar convite, alterar papel/status, ler e substituir permissões) e `/api/iam/namespaces`, todas protegidas por `core:usuarios:gerenciar`. Serviços `listUsers`, `setUserRole`, `setUserStatus`, `revokeNamespace` e `setUserPermissions` (diff-based), com auditoria.
- **Módulo de Administração (frontend)**: tela de usuários com lista, convite, alteração de papel/status e editor de permissões RBAC agrupadas por módulo. Registrado como módulo do portal, protegido por `core:usuarios:gerenciar`.

## [0.3.0] - 2026-09-19

### Adicionado

- **Bootstrap do SuperAdministrador**: CLI `create-admin` (idempotente) que cria/promove o usuário superadmin, define a senha e concede todos os namespaces RBAC. Integrado ao `install.sh` (credenciais por ambiente ou senha gerada e exibida uma única vez).
- **Catálogo de namespaces RBAC** do núcleo e do CRM (`core/iam/namespaces.ts`).
- **Telas do CRM no frontend**: Campanhas (listar/criar/disparar), Relatórios (fechamentos, SLA, performance, motivos de perda), Conversas (canal da equipe) e Configurações (listas configuráveis + SLA por etapa), cada uma protegida por seu namespace.
- **Endpoint `GET /api/crm/campaigns`** e cliente de API tipado para os recursos adicionais do CRM.

## [0.2.0] - 2026-09-19

### Adicionado

- **Portal web (frontend)**: SPA em React + TypeScript + Vite + Material UI, em `frontend/`. Base extensível com registro declarativo de módulos (`ModuleDefinition`), autenticação (login e primeiro acesso via IAM), tema white-label e cliente de API tipado (TanStack Query + Zustand).
- **Módulo CRM no frontend**: pipeline Kanban com drag-and-drop (respeitando `crm:pipeline:mover`), criação de lead e painel de detalhe com dados de contato da Base Central e timeline.
- **Endpoint `/api/auth/me`** e inclusão das permissões RBAC na resposta de login, para o controle de acesso do frontend.
- **Entrega via nginx**: configuração em `deploy/nginx/hubcentral.conf` (SPA + reverse proxy `/api`, TLS-ready) e integração no `install.sh` (compila o frontend e configura o nginx).

## [0.1.1] - 2026-09-19

### Adicionado

- **Instalador Linux** (`scripts/install.sh`): instala ou atualiza o HUB Central via `curl -sSL <url> | sudo sh`. Foco em Debian/Ubuntu (apt), com suporte a dnf/yum. Instala Node.js 20, git, build tools e (opcionalmente) PostgreSQL; cria usuário de sistema, clona/atualiza em `/opt/hubcentral`, gera/preserva `.env`, aplica migrations e instala um serviço systemd (`hubcentral.service`).
- **Script npm `start`**: `node dist/server.js`, usado pelo serviço systemd.
- **Seção Implantação (Linux)** no README com instruções de instalação, atualização, banco local vs externo e operação via systemd.

## [0.1.0] - 2026-09-19

### Adicionado

- **Fundação**: projeto Node.js 20+/TypeScript estrito (ESM), migrations via node-pg-migrate, infraestrutura de testes com Vitest + fast-check + Postgres efêmero (Testcontainers).
- **Base Central de Contatos** (`core`): contatos como fonte única de verdade (pessoa/empresa) com deduplicação; vínculos empresa↔pessoa; categorias de sistema e customizadas; campos personalizados (definição tipada + valores JSONB); mesclagem de contatos; segmentação; proteção de exclusão por referências ativas.
- **Contrato de Módulos**: registro por manifesto com validação (SemVer, schema `mod_[nome]`, tabelas de núcleo); referências de contato sem duplicação; RBAC por namespace `[modulo]:[recurso]:[acao]`; import/export CSV/JSON/XLSX com permissões explícitas; barramento de eventos (transactional outbox); auditoria imutável em `core.system_logs`; lint de contrato de schema.
- **IAM**: credenciais com scrypt; papéis (superadmin, module_admin, operator, client); sessões por token opaco (hash em repouso); convite com senha temporária, definição de senha no primeiro acesso e cooldown de reenvio de 60 min.
- **Módulo CRM** (`mod_crm`): leads referenciando contatos centrais (find-or-create); pipeline com SLA (memória entre etapas e níveis de urgência); timeline imutável; mensageria interna (canal de equipe e DMs, alertas); campanhas segmentadas; relatórios.
- **Infraestrutura HTTP**: API REST (Fastify) com autenticação por Bearer token e mapeamento de erros de domínio para HTTP; worker de despacho do outbox.

### Notas

- Envio real de e-mail/SMS/WhatsApp, scheduler de alertas de SLA e geração binária de XLSX ficam para versões futuras.
