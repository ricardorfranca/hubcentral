# Implementation Plan — Módulo de Projetos Internos

Plano incremental. Cada tarefa referencia os requisitos que atende. Backend com Vitest + Testcontainers (Postgres real); frontend com typecheck/test/build. Núcleo primeiro (notificações + configurações), depois o módulo, depois o frontend, e por fim instalador/docs/release.

## Fase 1 — Núcleo: Central de Notificações e Central de Configurações

- [x] 1.1 Migration `core-notifications`: criar `core.notifications` (campos do design, incluindo `source_event_id`) e índices `(recipient_user_id, read)`. Escrever `.up.sql` e `.down.sql`. _Req 8_
- [x] 1.2 Migration `core-settings`: criar `core.settings` (key, module, value, value_type, label, description, default_value, updated_at, updated_by) e índice por `module`. `.up`/`.down`. _Req 13_
- [x] 1.3 `src/core/notifications/notification-service.ts`: `notify` (insert idempotente por `source_event_id`+destinatário), `listForUser`, `markRead`, `unreadCount`. Testes de integração. _Req 8_
- [x] 1.4 `src/core/settings/settings-service.ts`: `registerSetting`, `getSetting`/`getSettingInt`/`getSettingList` (persistido → default → env), `listSettings({module})`, `setSetting` (persiste + audita). Testes de integração incluindo precedência e fallback. _Req 13_
- [x] 1.5 Namespace `core:config:gerenciar` em `CORE_NAMESPACES`/`ALL_NAMESPACES`. Rotas `src/http/routes/notifications.ts` (`GET /api/notifications`, `GET /unread-count`, `POST /:id/read`) e `src/http/routes/settings.ts` (`GET /api/settings`, `PATCH /api/settings/:key`, com `authorize(core:config:gerenciar)`). Registrar em `app.ts`. Testes de rota. _Req 8, 13_

## Fase 2 — Módulo Projetos: schema e serviços base

- [x] 2.1 Migration `projetos-schema`: `CREATE SCHEMA mod_projetos`; tabelas `projects` (com `detail`), `project_members`; índices. `.up`/`.down`. _Req 1, 2_
- [x] 2.2 Migration `projetos-tasks`: `tasks` (status enum via CHECK, `position`), `task_assignees`; índices `(project_id, status, position)`, `(user_id)`. `.up`/`.down`. _Req 3, 5_
- [x] 2.3 Migration `projetos-comments-attachments`: `project_comments`, `task_comments`, `task_attachments`; seed das chaves `projetos.uploads.*` em `core.settings` via `registerSetting`. `.up`/`.down`. _Req 6, 7, 12, 13_
- [x] 2.4 Namespaces `PROJETOS_NAMESPACES` (lista do design) em `namespaces.ts` + `ALL_NAMESPACES`. _Req 9_
- [x] 2.5 Códigos de erro em `errors.ts`: `PROJ_ACCESS_DENIED`, `PROJ_NOT_FOUND`, `PROJ_TASK_NOT_FOUND`, `PROJ_ARCHIVED`, `PROJ_ATTACHMENT_INVALID`, `PROJ_ATTACHMENT_NOT_FOUND`. Mapear no `error-mapping.ts` (status HTTP). _Req 9_
- [x] 2.6 `project-service.ts`: create/update/archive, `listProjectsForUser`, `getProject`, `assertProjectAccess`; auditoria. Testes: criação adiciona dono como membro; arquivamento bloqueia criação/movimentação; acesso negado a não-participante. _Req 1, 2_
- [x] 2.7 `member-service.ts`: add/remove/list; remover membro remove atribuições. Auditoria. Testes. _Req 2_

## Fase 3 — Módulo Projetos: tarefas, atribuição, comentários, eventos

- [x] 3.1 `task-service.ts`: createTask (posição no fim da coluna, bloqueia se arquivado), updateTask, `listTasksByProject` (agrupado por status/ordenado), `moveTask` (audita + publica `projetos.tarefa.movida`). Testes de Kanban e ordenação. _Req 3, 4_
- [x] 3.2 `assignment-service.ts`: assign (valida dono/membro; publica `projetos.tarefa.atribuida`), unassign; auditoria. Testes. _Req 5_
- [x] 3.3 `comment-service.ts`: addTaskComment (`projetos.comentario.criado`), addProjectComment (`projetos.projeto.comentado`); auditoria. Testes cronologia. _Req 6, 12_
- [x] 3.4 `notifier.ts`: `registerProjetosNotifier` assina `projetos.*` e cria notificações para os destinatários corretos (inclui dono, exclui autor; comentário de projeto → dono + membros). Chamar no bootstrap junto ao outbox worker. Testes evento→notificação + dedupe por `source_event_id`. _Req 4, 5, 6, 8, 10, 12_

## Fase 4 — Módulo Projetos: anexos e rotas HTTP

- [x] 4.1 Adicionar `@fastify/multipart`; registrar no `app.ts`. _Req 7_
- [x] 4.2 `attachment-service.ts`: saveAttachment (grava metadados), listAttachments, getAttachment (download), deleteAttachment (remove arquivo + metadados; audita). Nome seguro por UUID; validação lê limites de `core.settings` (`getSettingInt`/`getSettingList`), env como fallback. Escrita atômica (temp + rename). Testes: rejeição por tamanho/tipo, nome seguro, exclusão remove arquivo. _Req 7, 13_
- [x] 4.3 `src/http/routes/projetos.ts`: todas as rotas do design (projetos, membros, tarefas, move, assignees, comments, attachments upload/download/delete) com `authorize` + `assertProjectAccess`. Registrar em `app.ts`. Testes de rota (RBAC nega sem namespace; nega acesso a projeto alheio mesmo com namespace). _Req 1–7, 9, 12_

## Fase 5 — Frontend: núcleo (notificações, settings, menu agrupado)

- [x] 5.1 `core/api/notifications.ts` + `core/notifications/hooks.ts` (`useUnreadCount` com refetchInterval, `useNotifications`, `useMarkRead`). _Req 8_
- [x] 5.2 `core/notifications/NotificationBell.tsx` no `AppBar` do Shell: badge de não lidas, popover com lista, clicar navega para `link` e marca lida, "marcar todas". _Req 8_
- [x] 5.3 Menu lateral agrupado por módulo no `Shell.tsx`: cabeçalho (`ListSubheader`) por módulo, itens filtrados por RBAC, seção omitida se sem permissão. _Req 11_
- [x] 5.4 `core/api/settings.ts` + `modules/admin/SettingsPage.tsx`: lista agrupada por módulo, editor por `value_type`; item de menu do Admin sob `core:config:gerenciar`. _Req 13_

## Fase 6 — Frontend: telas do módulo Projetos

- [x] 6.1 `core/api/projetos.ts` (funções tipadas) + `modules/projetos/hooks.ts` (queries/mutations com invalidação). _Req 1–7, 12_
- [x] 6.2 `ProjectsPage.tsx` (lista dos projetos do usuário + criar) e `module.tsx` (`ModuleDefinition`, registrado em `MODULE_REGISTRY`). _Req 1, 11_
- [x] 6.3 `ProjectDetailPage.tsx` (dados, descritivo principal, membros, comentários do projeto) + `ProjectBoard.tsx` (Kanban 3 colunas, DnD com `projetos:tarefa:mover`). _Req 2, 3, 4, 12_
- [x] 6.4 `TaskDetailDialog.tsx`: atribuídos, comentários, anexos (upload/lista/download/excluir). _Req 5, 6, 7_
- [x] 6.5 Typecheck + testes + build do frontend.

## Fase 7 — Instalador, documentação e release

- [ ] 7.1 `.env.example`: `UPLOADS_DIR`, `UPLOADS_MAX_BYTES`, `UPLOADS_ALLOWED`. `scripts/install.sh`: criar `UPLOADS_DIR` (dono `hubcentral`); doc de backup inclui o diretório. _Req 7_
- [ ] 7.2 Docs: README (novo módulo, rotas, central de notificações e de configurações, menu agrupado), `ModuloCRM.md`/novo README do módulo se aplicável, CHANGELOG; nota de reconcessão de RBAC (`projetos:*`, `core:config:gerenciar`) via `reset-admin.sh`. _Req 9, 13_
- [ ] 7.3 Verificação backend (typecheck + testes + build) e frontend; bump de versão (0.7.0); commit; `gh release create` em `main`; confirmar workflow anexando `frontend-dist.tar.gz`. _Todos_
