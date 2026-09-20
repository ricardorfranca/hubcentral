# HUB Central

Plataforma parametrizável de centralização, orquestração e integração de serviços — um conector universal e barramento de serviços que conecta ERPs, CRMs, bancos, APIs externas e módulos nativos, com um portal operacional unificado.

**Modelo arquitetural:** Monólito Modular Extensível com Arquitetura Orientada a Eventos (EDA).

## Sumário

- [Visão geral](#visão-geral)
- [Arquitetura](#arquitetura)
- [Stack](#stack)
- [Setup](#setup)
- [Banco de dados e migrations](#banco-de-dados-e-migrations)
- [Executando](#executando)
- [Testes](#testes)
- [API HTTP](#api-http)
- [Módulos](#módulos)
- [Estado atual](#estado-atual)

## Visão geral

O HUB Central é composto por um **núcleo** (schema `core`) e **módulos satélites** (schemas `mod_[nome]`). O núcleo fornece identidade centralizada (IAM), a Base Central de Contatos como fonte única de verdade, auditoria imutável, um barramento de eventos e o contrato que todo módulo deve cumprir. O primeiro módulo é o **CRM** (`mod_crm`).

Princípios:

- **Isolamento estrito por schema** — dados do núcleo em `core`, dados de cada módulo em `mod_[nome]`.
- **Referenciar sem duplicar** — módulos guardam apenas `contact_id`; nenhum dado de contato é copiado.
- **IAM e auditoria centralizados** — identidade em `core.users`, auditoria imutável em `core.system_logs`.
- **Desacoplamento por eventos** — módulos publicam/assinam eventos via um transactional outbox.

## Arquitetura

```
HUB Central
├── core (núcleo)
│   ├── IAM               — usuários, credenciais (scrypt), sessões, RBAC
│   ├── Contatos          — fonte única de verdade (pessoas/empresas)
│   ├── Vínculos          — empresa ↔ pessoa (M:N)
│   ├── Categorias        — sistema + customizadas
│   ├── Campos personalizados — definição tipada + valores JSONB
│   ├── Segmentos         — filtros que retornam apenas contact_id
│   ├── Contrato de módulos — manifesto, referências, eventos, import/export
│   ├── Auditoria         — core.system_logs imutável
│   ├── Notificações      — core.notifications in-app (reutilizável por módulos)
│   ├── Configurações     — core.settings por módulo (Central de Configurações)
│   └── Eventos           — transactional outbox + pub/sub
└── mod_crm (módulo satélite) — CRM 2.0 (Receita Previsível, B2B)
    ├── Contas            — empresas (CNPJ) referenciando contatos centrais
    ├── Oportunidades     — MRR + valor único, origem/qualificação, ARR derivado
    ├── Pipeline & SLA    — estágios configuráveis (probabilidade) + SLA
    ├── Atividades        — cadência de vendas (ligação/e-mail/reunião/tarefa/nota)
    ├── Forecast          — ponderado, novo MRR/ARR, pipeline por estágio/origem/dono
    ├── Timeline          — histórico imutável
    ├── Mensageria        — canal de equipe + DMs
    ├── Campanhas         — segmentadas por etiquetas
    └── Relatórios        — fechamentos, perdas, performance, SLA

    mod_projetos (módulo satélite) — Projetos Internos 2.0
    ├── Projetos          — dono + membros, descritivo, prazo, valor/hora
    ├── Tarefas (Kanban)  — 3 colunas fixas + prazo, responsável único, dependência
    ├── Gantt             — visão temporal do projeto
    ├── Tempo & custos    — apontamento por comentário, recursos/custos, totais
    ├── Comentários       — no nível de tarefa e de projeto (anotação auto ao mover)
    ├── Anexos            — arquivos por tarefa em disco local
    └── Relatório & dash  — PDF executivo e dashboard do superadmin
```

## Stack

| Camada | Tecnologia |
|--------|------------|
| Runtime | Node.js 20+ (ESM) |
| Linguagem | TypeScript (estrito) |
| Banco | PostgreSQL 15+ |
| HTTP | Fastify 5 |
| Migrations | node-pg-migrate |
| Testes | Vitest + fast-check (property-based) |
| Banco de teste | Postgres efêmero via Testcontainers |

## Setup

Pré-requisitos: Node.js 20+, Docker (para os testes), e um PostgreSQL 15+ para execução.

```bash
# 1. Instalar dependências
npm install

# 2. Configurar variáveis de ambiente
cp .env.example .env
# edite .env com a URL do seu PostgreSQL
```

Variáveis de ambiente (ver `.env.example`):

| Variável | Descrição |
|----------|-----------|
| `DATABASE_URL` | URL de conexão PostgreSQL (`postgres://user:pass@host:porta/db`) |
| `PORT` | Porta da API HTTP (default `3000`) |

## Banco de dados e migrations

As migrations ficam em `migrations/` (SQL puro, gerenciadas por node-pg-migrate) e criam os schemas `core` e `mod_crm`, as extensões `pgcrypto` e `citext`, e todas as tabelas.

```bash
# Aplicar todas as migrations (usa DATABASE_URL)
npm run migrate:up

# Reverter a última
npm run migrate:down

# Criar uma nova migration (SQL)
npm run migrate:create -- nome-da-migration
```

## Executando

```bash
# Compilar
npm run build

# Iniciar a API + worker de eventos
node dist/server.js
```

O processo sobe a API HTTP e um worker que despacha os eventos pendentes do outbox. Encerra de forma limpa em SIGINT/SIGTERM.

## Testes

```bash
# Suíte completa (sobe um Postgres efêmero via Testcontainers)
npm test

# Verificação de tipos
npm run typecheck
```

Os testes usam **property-based testing** (fast-check) para validar as propriedades de correção do design, além de testes de exemplo, integração HTTP e um lint de contrato que garante que nenhum módulo copie dados de contato.

## API HTTP

Autenticação por Bearer token de sessão (obtido no login). Rotas protegidas exigem `Authorization: Bearer <token>`.

### Autenticação (IAM)

| Método | Rota | Descrição |
|--------|------|-----------|
| POST | `/api/auth/login` | Login por e-mail/senha; retorna token e `must_change_password` |
| POST | `/api/auth/set-password` | Define senha (primeiro acesso ou troca) |
| POST | `/api/auth/logout` | Revoga a sessão do token |

### Contatos e segmentos (core)

| Método | Rota | Descrição |
|--------|------|-----------|
| POST | `/api/contacts` | Criar contato (pessoa/empresa) |
| GET | `/api/contacts/:id` | Obter contato |
| PATCH | `/api/contacts/:id` | Atualizar (publica `core.contato.atualizado`) |
| DELETE | `/api/contacts/:id` | Excluir (bloqueado se referenciado) |
| POST | `/api/segments` | Criar segmento persistido |
| POST | `/api/segments/evaluate` | Avaliar critérios (retorna `contact_id`) |

### CRM (`mod_crm`)

| Método | Rota | Descrição |
|--------|------|-----------|
| GET/POST | `/api/crm/accounts` | Listar/criar contas (empresa via CNPJ) |
| GET | `/api/crm/accounts/:id` | Conta com contatos vinculados |
| POST | `/api/crm/accounts/:id/contacts` | Vincular contato (pessoa) à conta |
| GET/POST | `/api/crm/opportunities` | Listar (com filtros)/criar oportunidades |
| GET | `/api/crm/opportunities/:id` | Detalhe da oportunidade (MRR/ARR) |
| PATCH | `/api/crm/opportunities/:id/stage` | Mover de estágio |
| PATCH | `/api/crm/opportunities/:id/finalize` | Ganho (com valores) / perdido (com motivo) |
| GET/PATCH | `/api/crm/stages[/:id]` | Estágios do pipeline (probabilidade) |
| GET | `/api/crm/forecast` | Forecast ponderado e agregados de Receita Previsível |
| GET/POST | `/api/crm/activities[/mine]` | Atividades (agenda pessoal) |
| POST | `/api/crm/activities/:id/complete` | Concluir atividade |
| GET | `/api/crm/opportunities/:id/activities` | Atividades da oportunidade |
| GET | `/api/crm/conversations` | Conversas do usuário (não lidas) |
| POST | `/api/crm/conversations/:id/read` | Marcar conversa como lida |
| GET/POST | `/api/crm/lists/:type` | Listas configuráveis |
| GET/PUT | `/api/crm/sla/:columnId` | SLA por etapa |
| GET/POST | `/api/crm/messages[/:conversationId]` | Mensageria interna |
| POST | `/api/crm/campaigns` | Criar campanha |
| POST | `/api/crm/campaigns/:id/dispatch` | Disparar campanha |
| GET | `/api/crm/reports/{closings,loss-reasons,performance,sla}` | Relatórios |

### Projetos Internos (`mod_projetos`)

| Método | Rota | Descrição |
|--------|------|-----------|
| GET/POST | `/api/projetos` | Listar (só os do usuário) / criar projeto |
| GET/PATCH | `/api/projetos/:id` | Detalhe (membros, comentários) / editar |
| POST | `/api/projetos/:id/archive` | Arquivar projeto |
| GET/POST/DELETE | `/api/projetos/:id/members[/:userId]` | Gerenciar membros |
| POST | `/api/projetos/:id/comments` | Comentar no projeto |
| GET/POST | `/api/projetos/:id/tasks` | Tarefas (Kanban) / criar |
| GET/PATCH | `/api/projetos/tasks/:taskId` | Detalhe / editar tarefa |
| PATCH | `/api/projetos/tasks/:taskId/move` | Mover de coluna |
| POST/DELETE | `/api/projetos/tasks/:taskId/assignees[/:userId]` | Atribuir/desatribuir |
| POST | `/api/projetos/tasks/:taskId/comments` | Comentar na tarefa |
| POST/GET/DELETE | `/api/projetos/tasks/:taskId/attachments`, `/api/projetos/attachments/:id` | Anexos (upload/download/excluir) |

### Núcleo — notificações e configurações

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/notifications[/unread-count]` | Notificações do usuário / contador |
| POST | `/api/notifications/:id/read`, `/read-all` | Marcar como lida(s) |
| GET/PATCH | `/api/settings[/:key]` | Central de Configurações (por módulo) |

## Implantação (Linux)

O HUB Central inclui um instalador para servidores Linux (foco em Debian/Ubuntu; também tenta dnf/yum). O mesmo script **instala** numa máquina nova e **atualiza** uma instalação existente — é idempotente e preserva o `.env`.

### Instalação rápida (one-liner)

```bash
curl -sSL https://raw.githubusercontent.com/ricardorfranca/hubcentral/main/scripts/install.sh | sudo sh
```

> **Segurança:** `curl | sh` executa código com privilégios de root. Para revisar antes de rodar (recomendado):
>
> ```bash
> curl -sSL https://raw.githubusercontent.com/ricardorfranca/hubcentral/main/scripts/install.sh -o install.sh
> less install.sh   # inspecione
> sudo sh install.sh
> ```

### O que o instalador faz

1. Detecta o gerenciador de pacotes e instala dependências: **Node.js 20 LTS**, git, build tools e (opcionalmente) **PostgreSQL**.
2. Cria o usuário de sistema `hubcentral` (sem shell) para rodar o serviço.
3. Clona o repositório em `/opt/hubcentral` (ou atualiza, se já existir).
4. Gera um `.env` inicial (na primeira vez) ou preserva o existente.
5. Roda `npm ci`, `npm run build` e aplica as migrations.
6. Instala e (re)inicia um serviço **systemd** (`hubcentral.service`) com restart automático.
7. Compila o **frontend** e instala/configura o **nginx** para servir o portal web (porta 80) com reverse proxy de `/api`.
8. Cria o **SuperAdministrador** inicial (apenas na primeira instalação).

### VMs pequenas (ex.: 1 GB de RAM)

O frontend é compilado no CI e publicado como artefato da release; o instalador baixa o `dist` pronto, sem compilar no servidor. Além disso, se houver pouca RAM e nenhum swap, o instalador ativa um swap temporário de 2 GB durante o build do backend e o remove ao final. Assim a instalação funciona mesmo em VMs de 1 GB.

### Primeiro acesso (SuperAdministrador)

Na primeira instalação, o script cria um SuperAdministrador e concede todas as permissões. Você pode definir as credenciais por ambiente:

```bash
curl -sSL https://raw.githubusercontent.com/ricardorfranca/hubcentral/main/scripts/install.sh \
  | sudo HUBCENTRAL_ADMIN_EMAIL="voce@empresa.com" HUBCENTRAL_ADMIN_PASSWORD="suaSenhaForte" sh
```

Se não forem informadas, o script gera uma senha aleatória e a **exibe uma única vez** ao final da instalação. Em atualizações, o SuperAdministrador não é recriado.

**Descobrir o SuperAdministrador atual:**

```bash
cd /opt/hubcentral && set -a && . ./.env && set +a
sudo -u postgres psql "$DATABASE_URL" -c "SELECT email, role, status FROM core.users WHERE role='superadmin';"
```

**Redefinir a senha (ou criar) do SuperAdministrador** — use o script pronto (idempotente):

```bash
sudo /opt/hubcentral/scripts/reset-admin.sh "email@empresa.com" "NovaSenhaForte"
```

O script define a senha, garante o papel `superadmin` e concede todas as permissões. A senha já fica ativa (sem tela de troca no primeiro acesso).

### Banco de dados

- **Padrão (DB local):** se você não fornecer `DATABASE_URL`, o instalador instala o PostgreSQL, cria o banco `hub_central` e um usuário com senha aleatória, gravando a conexão no `.env`.
- **DB externo (RDS, gerenciado):** forneça a URL e o Postgres local é ignorado:

  ```bash
  curl -sSL https://raw.githubusercontent.com/ricardorfranca/hubcentral/main/scripts/install.sh \
    | sudo DATABASE_URL="postgres://user:senha@host:5432/hub_central" sh
  ```

### Variáveis do instalador

| Variável | Default | Descrição |
|----------|---------|-----------|
| `DATABASE_URL` | (vazio) | Se definida, usa este banco e não instala Postgres local |
| `HUBCENTRAL_REF` | `main` | Branch ou tag a instalar (ex.: `v0.1.0`) |
| `INSTALL_DIR` | `/opt/hubcentral` | Diretório de instalação |

### Atualizar uma instalação existente

Basta rodar o mesmo comando de instalação novamente: o script faz `git pull`, reconstrói, aplica novas migrations e reinicia o serviço, mantendo o `.env`.

### Operação (systemd)

```bash
systemctl status hubcentral      # estado do serviço
journalctl -u hubcentral -f      # logs em tempo real
systemctl restart hubcentral     # reiniciar
```


## Frontend

O portal web é uma SPA em **React + TypeScript + Vite + Material UI**, em `frontend/`. É uma base consolidada e extensível: cada módulo registra suas telas, menus e permissões de forma declarativa (`ModuleDefinition`), do mesmo modo que o backend usa o Contrato de Módulos. Inclui autenticação (login e primeiro acesso), tema white-label e o módulo CRM 2.0 completo (Receita Previsível): **oportunidades** (Kanban por estágio + detalhe com MRR/ARR e finalização), **contas**, **atividades**, **dashboards de Receita Previsível**, **conversas**, **campanhas**, **relatórios** e **configurações** (listas e SLA por estágio).

```bash
cd frontend
npm install
npm run dev      # dev server (proxy /api -> http://127.0.0.1:3000)
npm run build    # gera frontend/dist (servido pelo nginx em produção)
npm test         # testes (Vitest + Testing Library)
```

O portal também inclui o módulo de **Projetos Internos** (quadro Kanban de tarefas com comentários e anexos) e o módulo de **Administração** (gestão de usuários e a **Central de Configurações**): convite, papéis, ativação/desativação, edição de permissões RBAC por usuário e ajuste de parâmetros por módulo — visível para quem tem `core:usuarios:gerenciar`/`core:config:gerenciar`. O menu lateral é **agrupado por módulo**, e um **sino de notificações** no topo mostra as notificações in-app do usuário.

Estrutura: `src/core` (api, auth, branding, rbac, registro de módulos) e `src/modules/<modulo>` (telas de cada módulo). Adicionar um módulo = criar seu `ModuleDefinition` e registrá-lo em `src/core/modules/registry.ts` — o Shell não muda.

O portal é servido em produção pelo **nginx** (config em `deploy/nginx/hubcentral.conf`), que entrega a SPA e faz reverse proxy de `/api` para o backend. O `install.sh` compila o frontend e configura o nginx automaticamente.

## Módulos

Documentação detalhada por área:

- [Núcleo (`core`)](src/core/README.md)
- [Módulo CRM (`mod_crm`)](src/modules/crm/README.md)

As especificações formais (requisitos, design e plano de tarefas) ficam em `.kiro/specs/`.

## Estado atual

Implementado e coberto por testes (property-based + integração):

- **Base Central de Contatos** — contatos, deduplicação, vínculos empresa↔pessoa, categorias, campos personalizados, mesclagem, segmentação, proteção de exclusão.
- **Contrato de Módulos** — registro por manifesto, referências sem duplicação, RBAC, import/export (CSV/JSON/XLSX), eventos, auditoria imutável, lint de contrato.
- **IAM** — credenciais (scrypt), papéis, sessões por token, convite com senha temporária, primeiro acesso, cooldown de reenvio.
- **CRM 2.0 (Receita Previsível, B2B)** — contas (empresas) permanentes referenciando a Base Central; oportunidades efêmeras com MRR + valor único e ARR derivado; pipeline de estágios configuráveis com probabilidade e SLA; atividades (cadência de vendas); forecast ponderado e dashboards; timeline, mensageria, campanhas e relatórios.
- **Projetos Internos 2.0** — projetos com dono/membros (IAM), prazo e valor/hora; Kanban de 3 colunas com prazo, responsável único, visibilidade e dependência entre tarefas; Gantt; apontamento de tempo por comentário com totais; recursos/custos; anotação automática ao mover; anexos; desarquivar; relatório executivo em PDF; dashboard do superadmin; notificações in-app aos envolvidos.
- **Contatos (Base Central)** — tela de gestão de pessoas e empresas (leads ou não) com rótulos e busca; autofill de CNPJ (BrasilAPI); telefone padronizado BR (+55, E.164). É a fonte única referenciada por CRM, Projetos e campanhas.
- **Campanhas** — segmentação por etiquetas e disparo multicanal (Email/WhatsApp/SMS) com status, assunto, formato texto/HTML e variáveis; SMS via Clickatell ou GoIP.
- **Núcleo — Notificações, Configurações, E-mail, SMS e Backup** — Central de Notificações in-app reutilizável; Central de Configurações por módulo (persistido → default → env); envio de e-mail SMTP e SMS (Clickatell/GoIP) com teste; backup/restore (banco + anexos) para o superadmin. Identidade visual (nome, logo, cores) e modo escuro no portal.
- **Infraestrutura** — API HTTP (Fastify), worker de despacho do outbox.

### Pendências conhecidas

- Envio real de e-mail/SMS/WhatsApp nas campanhas (depende de canais SMTP/SES/WhatsApp configurados).
- Scheduler periódico que aciona alertas automáticos de SLA quando um lead entra em estado crítico (a lógica de urgência e o alerta já existem; falta o disparador temporal).
- Geração binária de XLSX (hoje o formato usa intercâmbio JSON no núcleo).

## Licença

Uso privado. Todos os direitos reservados.
