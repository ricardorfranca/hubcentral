# Changelog

Todas as mudanças relevantes deste projeto são documentadas aqui. O formato segue o versionamento semântico (SemVer).

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
