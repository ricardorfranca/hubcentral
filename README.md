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
│   └── Eventos           — transactional outbox + pub/sub
└── mod_crm (módulo satélite)
    ├── Leads             — referenciam contatos centrais
    ├── Pipeline & SLA    — etapas + SLA com memória entre etapas
    ├── Timeline          — histórico imutável do lead
    ├── Mensageria        — canal de equipe + DMs
    ├── Campanhas         — segmentadas por etiquetas
    └── Relatórios        — fechamentos, perdas, performance, SLA
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
| POST | `/api/crm/leads` | Criar lead (find-or-create de contatos) |
| GET | `/api/crm/leads/:id` | Visão do lead com dados de contato resolvidos |
| PATCH | `/api/crm/leads/:id/move` | Mover no pipeline (aplica SLA) |
| PATCH | `/api/crm/leads/:id/finalize` | Ganho/perdido |
| GET | `/api/crm/leads/:id/timeline` | Timeline do lead |
| GET/POST | `/api/crm/lists/:type` | Listas configuráveis |
| GET/PUT | `/api/crm/sla/:columnId` | SLA por etapa |
| GET/POST | `/api/crm/messages[/:conversationId]` | Mensageria interna |
| POST | `/api/crm/campaigns` | Criar campanha |
| POST | `/api/crm/campaigns/:id/dispatch` | Disparar campanha |
| GET | `/api/crm/reports/{closings,loss-reasons,performance,sla}` | Relatórios |

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
- **CRM** — leads referenciando contatos, pipeline com SLA (memória entre etapas), timeline, mensageria, campanhas, relatórios.
- **Infraestrutura** — API HTTP (Fastify), worker de despacho do outbox.

### Pendências conhecidas

- Envio real de e-mail/SMS/WhatsApp nas campanhas (depende de canais SMTP/SES/WhatsApp configurados).
- Scheduler periódico que aciona alertas automáticos de SLA quando um lead entra em estado crítico (a lógica de urgência e o alerta já existem; falta o disparador temporal).
- Geração binária de XLSX (hoje o formato usa intercâmbio JSON no núcleo).

## Licença

Uso privado. Todos os direitos reservados.
