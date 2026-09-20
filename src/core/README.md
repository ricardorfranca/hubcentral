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
