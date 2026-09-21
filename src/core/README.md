# Núcleo (`core`)

O núcleo do HUB Central. Fornece os serviços centrais consumidos por todos os módulos satélites.

## Componentes

| Diretório | Responsabilidade |
|-----------|------------------|
| `db/` | Pool de conexões e helper de transação (`withTransaction`) |
| `contacts/` | Base Central de Contatos: contatos, vínculos, categorias, campos personalizados, segmentos, referências, mesclagem |
| `iam/` | Identidade: senha (scrypt), provisionamento, sessões, RBAC |
| `events/` | Barramento de eventos (transactional outbox) e worker de despacho |
| `audit/` | Logger de auditoria (única porta de escrita em `core.system_logs`) |
| `modules/` | Registro e validação de módulos satélites (manifesto) |
| `io/` | Formatos (CSV/JSON/XLSX) e gateway de import/export com RBAC |
| `contract/` | Lint de contrato de schema (impede módulos de copiar dados de contato) |
| `errors.ts` | `DomainError` com formato `{ code, message, details }` |

## Princípios

- **Fonte única de verdade**: contatos vivem em `core.contacts`; módulos referenciam por `contact_id`.
- **Auditoria imutável**: `core.system_logs` é append-only (trigger bloqueia UPDATE/DELETE).
- **Eventos**: publicados na mesma transação da mudança (`core.event_outbox`), despachados por um worker.

## Tabelas principais

`core.users`, `core.sessions`, `core.user_permissions`, `core.contacts`, `core.contact_company_links`, `core.contact_categories`, `core.contact_category_assignments`, `core.custom_field_defs`, `core.contact_custom_field_values`, `core.contact_references`, `core.segments`, `core.system_logs`, `core.event_outbox`, `core.registered_modules`.

### `core.contacts` — campos de empresa

Uma empresa é uma linha com `contact_type = 'empresa'`. Obrigatórios: `legal_name` e `fiscal_document`. Dados cadastrais oficiais (todos opcionais):

| Coluna | Descrição |
|--------|-----------|
| `contract_active` | Cliente com contrato ativo (`true`) ou não (`false`); default `false` |
| `state_tax_id` | Inscrição estadual (ou "ISENTO") |
| `website` | Site institucional (normalizado com esquema `https://`) |
| `zip_code` | CEP, 8 dígitos sem máscara (CHECK); base do autofill de endereço |
| `street_address`, `address_number`, `address_complement` | Logradouro, número e complemento |
| `neighborhood`, `city`, `state` | Bairro, cidade e UF (2 letras maiúsculas, CHECK) |
| `phone_primary`, `phone_primary_is_whatsapp` | Telefone principal em E.164 e marcação de WhatsApp |
| `phone_secondary`, `phone_secondary_is_whatsapp` | Segundo telefone e marcação de WhatsApp |
| `account_manager_user_id` | Gerente de contas → `core.users` (`ON DELETE SET NULL`) |

O autofill vem de `contacts/cnpj-lookup.ts` (CNPJ) e `contacts/cep-lookup.ts` (CEP), ambos sobre a BrasilAPI, com timeout e degradação para `null`.

### `core.contact_company_links` — papéis

`role` é TEXT livre (compatibilidade), mas a API e a interface usam o vocabulário canônico de `contacts/link-service.ts`: `principal` (responsável principal), `tecnico`, `portabilidade` e `extra`. O papel `principal` é único por empresa (índice parcial `uq_ccl_company_principal`; o serviço antecipa a violação com `LINK_PRINCIPAL_EXISTS`).
