# Implementation Plan

Plano incremental e orientado a testes para a **Base Central de Contatos** (schema `core`) e o **Contrato de Módulos**, aderente a `requirements.md` e `design.md`. Backend de referência: Node.js 20+ (Express/Fastify) com PostgreSQL 15+, migrations via Flyway (ou ferramenta padrão do HUB), e testes de propriedade com **fast-check** (`{ numRuns: 100 }`). Cada teste de propriedade traz a tag **Feature: central-contacts-and-module-contract, Property {n}: {texto}**.

- [ ] 1. Preparar fundação de projeto, migrations e infraestrutura de testes
  - Configurar o runner de migrations (Flyway/padrão HUB) apontando para o schema `core`.
  - Configurar base Postgres 15 efêmera para testes (container) com transação revertida por caso.
  - Instalar e configurar fast-check para PBT e o runner de testes de exemplo/integração.
  - _Requirements: infraestrutura de suporte (§12 do CRM)_

- [ ] 2. Migration e modelo de `core.contacts` com deduplicação
  - [ ] 2.1 Criar migration de `core.contacts` (contact_type ENUM check, campos pessoa/empresa, `merged_into`, timestamps) com CHECKs condicionais por tipo e CHECK de regex de e-mail.
    - Criar índices únicos parciais: `email WHERE contact_type='pessoa' AND merged_into IS NULL` e `fiscal_document WHERE contact_type='empresa' AND merged_into IS NULL` (CITEXT).
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 5.1, 5.3_
  - [ ] 2.2 Implementar `ContactService.createContact` com validação de campos obrigatórios por tipo, validação de e-mail e pré-checagem de deduplicação.
    - Escrever testes de propriedade para P1 (identidade única), P2 (campos obrigatórios), P3 (validação de e-mail) e P12 (dedup por chave natural retornando `existing_contact_id`).
    - Escrever teste de exemplo para persistência de `contact_type` (1.2).
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 5.1, 5.2, 5.3, 5.4_

- [ ] 3. Vínculos empresa↔pessoa
  - [ ] 3.1 Criar migration de `core.contact_company_links` (FKs para contacts, `role` opcional, `UNIQUE(company_id, person_id)`).
    - _Requirements: 2.1, 2.2, 2.3, 2.5_
  - [ ] 3.2 Implementar `linkCompanyPerson`/`unlinkCompanyPerson`/`getCompaniesOfPerson` com validação de tipo dos dois lados (empresa/pessoa) e rejeição de duplicidade.
    - Escrever testes de propriedade para P4 (round-trip de vínculo), P5 (respeito ao tipo do lado empresa/pessoa) e P6 (unicidade/idempotência).
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

- [ ] 4. Categorias de contato
  - [ ] 4.1 Criar migration de `core.contact_categories` (name CITEXT UNIQUE, `is_system`) e `core.contact_category_assignments` (PK composta), com seed das 5 categorias de sistema.
    - _Requirements: 3.1, 3.2, 3.5_
  - [ ] 4.2 Implementar `assignCategory`, `createCustomCategory` e `listContactsByCategory`.
    - Escrever testes de propriedade para P7 (round-trip e filtragem), P8 (categoria customizada disponível) e P9 (unicidade case-insensitive).
    - Escrever teste de exemplo (smoke) para presença das 5 categorias de sistema (3.1).
    - _Requirements: 3.2, 3.3, 3.5, 3.6_

- [ ] 5. Campos personalizados (definição relacional + valor JSONB tipado)
  - [ ] 5.1 Criar migration de `core.custom_field_defs` (name CITEXT UNIQUE, data_type CHECK) e `core.contact_custom_field_values` (PK composta, value JSONB, índice GIN).
    - _Requirements: 4.1, 4.2_
  - [ ] 5.2 Implementar `defineCustomField`, `setCustomFieldValue` (validação do value contra o data_type) e `findContactsByCustomField`.
    - Escrever testes de propriedade para P10 (round-trip de valor) e P11 (validação de valor contra o tipo).
    - Escrever teste de exemplo para definição de campo (4.1).
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

- [ ] 6. Registro de referências de módulo e proteção de exclusão
  - [ ] 6.1 Criar migration de `core.contact_references` (module, table_name, contact_id FK `ON DELETE RESTRICT`, `UNIQUE(module, table_name, contact_id)`).
    - _Requirements: 7.1, 7.4, 7.5_
  - [ ] 6.2 Implementar `ReferenceService` (registerReference com validação de existência, removeReference, listModulesReferencing, hasActiveReferences) e `ContactService.deleteContact` bloqueando exclusão com referências ativas.
    - Escrever testes de propriedade para P17 (referência exige contato existente) e P18 (exclusão bloqueada com lista de módulos).
    - _Requirements: 7.1, 7.3, 7.4, 7.5_

- [ ] 7. Mesclagem de contatos
  - [ ] 7.1 Implementar `ContactService.mergeContacts` (exige mesmo `contact_type`; transfere vínculos, categorias, valores de campo personalizado e referências de módulo; marca origem via `merged_into`).
    - Escrever teste de propriedade para P13 (mesclagem conserva e transfere tudo, nada perdido nem duplicado).
    - _Requirements: 5.5_

- [ ] 8. Segmentação
  - [ ] 8.1 Criar migration de `core.segments` (name, criteria JSONB, created_by FK, created_at).
    - _Requirements: 6.4_
  - [ ] 8.2 Implementar `SegmentService` (createSegment; evaluateSegment que compila `SegmentCriteria` para SQL parametrizado projetando apenas `contact_id`; resolveForModule; rejeição de critério vazio).
    - Escrever testes de propriedade para P14 (retorna exatamente quem satisfaz todos os critérios, com oráculo em memória), P15 (saída contém apenas referências) e P16 (critério vazio rejeitado).
    - Escrever teste de exemplo para persistência de segmento (6.4).
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

- [ ] 9. Auditoria centralizada e imutável
  - [ ] 9.1 Criar migration que reforça a imutabilidade de `core.system_logs` (REVOKE UPDATE/DELETE da role da aplicação + trigger `BEFORE UPDATE OR DELETE` que lança exceção).
    - _Requirements: 13.4_
  - [ ] 9.2 Implementar `AuditLogger.log` como única porta de escrita (id, timestamp UTC, user_id, module, action, payload_before, payload_after, ip_address, user_agent) e instrumentar os serviços mutadores já implementados (contato, categoria, mesclagem).
    - Escrever testes de propriedade para P30 (log completo e correto por ação auditável) e P31 (imutabilidade: UPDATE/DELETE falham).
    - _Requirements: 1.7, 3.4, 5.6, 13.1, 13.3, 13.4_

- [ ] 10. Barramento de eventos (transactional outbox)
  - [ ] 10.1 Criar migration de `core.event_outbox` (event_name, envelope JSONB, status, created_at).
    - _Requirements: 12.1_
  - [ ] 10.2 Implementar `EventBus` (publish gravando no outbox na mesma transação da mudança; despachante que entrega aos assinantes e marca `dispatched`; subscribe por padrão) e o `EventEnvelope` padronizado; publicar `core.contato.atualizado` em `updateContact`.
    - Escrever testes de propriedade para P27 (formato do nome de evento), P28 (evento de contato carrega apenas a referência) e P29 (alteração de contato publica exatamente um `core.contato.atualizado`).
    - Escrever teste de exemplo para emissão condicionada à flag `emits_events` (12.1).
    - _Requirements: 12.1, 12.2, 12.3, 12.4_

- [ ] 11. Registro de módulos e validação de manifesto/namespaces
  - [ ] 11.1 Criar migration de `core.registered_modules` (module_id PK, manifest JSONB, version, registered_at).
    - _Requirements: 8.1_
  - [ ] 11.2 Implementar `ModuleRegistry.validateManifest` (campos obrigatórios, module_id único, schema `^mod_[a-z0-9_]+$`, requires_core_tables existem em information_schema, version SemVer) e `validateNamespaces` (formato `[modulo]:[recurso]:[acao]`), com auditoria de registro bem-sucedido.
    - Escrever testes de propriedade para P19 (campos obrigatórios), P20 (module_id único), P21 (padrão do schema), P22 (tabelas de núcleo requeridas), P23 (SemVer) e P24 (formato de namespace).
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 10.1, 10.2_

- [ ] 12. Autenticação IAM e autorização RBAC nas rotas de módulo
  - [ ] 12.1 Implementar middleware de autenticação delegada ao IAM (`core.users`) para rotas `mod_*` e verificação de posse de `RBAC_Namespace` por ação.
    - Escrever teste de propriedade para P25 (autorização por posse de namespace, incluindo exportar/importar).
    - Escrever testes de integração para autenticação (200/401) e exemplo para atribuição de namespace por papel (10.5).
    - _Requirements: 9.2, 9.3, 9.4, 10.3, 10.4, 10.5_

- [ ] 13. Gateway de importação/exportação
  - [ ] 13.1 Implementar `Import/Export Gateway` (export CSV/JSON/XLSX; import CSV/JSON/XLSX) com verificação de `[modulo]:[recurso]:{exportar|importar}`, validação de linhas na importação (persistir válidas, retornar rejeitadas com motivo) e auditoria do volume processado.
    - Escrever testes de propriedade para P26 (importação valida antes de persistir) e reuso de P25/P30 para permissão e auditoria.
    - Escrever testes de exemplo para presença de endpoints e formatos (11.1, 11.2).
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7_

- [ ] 14. Lint de schema (verificação de contrato)
  - [ ] 14.1 Implementar teste automatizado que inspeciona migrations `mod_*` e falha se houver: colunas de dados de contato (7.1/7.2), tabela de usuários (9.1), tabela de logs de auditoria (13.2), ou `mod_crm.leads` ainda com `name/company/email/phone` (14.1).
    - _Requirements: 7.1, 7.2, 9.1, 13.2, 14.1_

- [ ] 15. Migração do `mod_crm.leads` para referência de contatos
  - [ ] 15.1 Criar migration que adiciona `person_contact_id`/`company_contact_id` (FK→core.contacts) e migra os dados existentes via find-or-create (pessoa por e-mail; empresa por documento fiscal ou razão social), registra em `core.contact_references` e então dropa `name/company/email/phone`.
    - _Requirements: 14.1_
  - [ ] 15.2 Ajustar criação de lead do CRM para usar find-or-create (reutiliza contact_id existente; cria quando novo) e ligar exibição de dados de contato ao `ContactService.getContactData`.
    - Escrever teste de propriedade para P32 (find-or-create idempotente).
    - Escrever teste de integração para exibição de contato via `getContactData` (14.5).
    - _Requirements: 14.2, 14.3, 14.5_
  - [ ] 15.3 Ligar a segmentação de campanhas do CRM ao `SegmentService.evaluateSegment` (campanha recebe apenas `contact_id`).
    - Escrever teste de integração para campanha consumindo `evaluateSegment` (14.4).
    - _Requirements: 14.4_

- [ ] 16. Fiação de eventos `crm.lead.*` com referências de contato
  - [ ] 16.1 Ajustar os eventos emitidos pelo CRM (`crm.lead.criado`, `crm.lead.movido`, etc.) para carregar `person_contact_id`/`company_contact_id` no lugar de dados de contato, publicando via `EventBus`.
    - Reusar P27/P28 para validar formato e ausência de dados de contato nos payloads.
    - _Requirements: 12.2, 12.3_
