# Implementation Plan — Frontend Web

Plano incremental para o frontend do HUB Central (React+TS+Vite+MUI). Cada bloco é verificável (typecheck/build/testes).

- [ ] 1. Scaffold do projeto `frontend/`
  - Inicializar Vite (react-ts), instalar MUI v6, TanStack Query, React Router v6, Zustand, Vitest + Testing Library.
  - tsconfig estrito, scripts (dev, build, test, typecheck), proxy de dev para `/api`.
  - _Requirements: 6.1_

- [ ] 2. Cliente de API tipado e SessionStore
  - [ ] 2.1 `SessionStore` (Zustand, persistido) com token/user, login/logout.
  - [ ] 2.2 `ApiClient` (fetch + Bearer + ApiError {code,message,details} + 401→logout).
  - [ ] 2.3 Módulos tipados: `auth`, `contacts`, `segments`, `crm`.
  - Testes: injeção de token, mapeamento de erro, 401 aciona logout.
  - _Requirements: 1.6, 1.7, 4.1, 4.2, 4.3_

- [ ] 3. Branding e tema
  - `BrandingStore` + `ThemeProvider` MUI derivando cores; tema padrão como fallback.
  - _Requirements: 3.1, 3.2, 3.3_

- [ ] 4. RBAC no cliente
  - `can(namespace)` a partir das permissões da Sessao; hook `useCan`.
  - _Requirements: 2.3_

- [ ] 5. Autenticação (telas)
  - [ ] 5.1 Tela de login (logo do branding, erro sem revelar campo).
  - [ ] 5.2 Tela de definição de senha (primeiro acesso via must_change_password).
  - [ ] 5.3 `AuthGuard` redireciona rotas protegidas sem sessão; logout.
  - Testes: AuthGuard sem sessão redireciona; login sucesso/erro.
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 3.4_

- [ ] 6. Registro de módulos e Shell
  - [ ] 6.1 Tipos `ModuleDefinition`/`MenuEntry` e `Registro_Modulos`.
  - [ ] 6.2 `Shell` (header com logo/usuário, sidebar por registro filtrada por RBAC, área de conteúdo), rotas injetadas no Router, página de acesso negado.
  - Testes: sidebar oculta item sem permissão; rota sem permissão mostra acesso negado.
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

- [ ] 7. Módulo CRM — Kanban
  - [ ] 7.1 `ModuleDefinition` do CRM (menu, rotas, namespaces) plugado no registro.
  - [ ] 7.2 Board Kanban (colunas = etapas) consumindo `useLeads`; criar lead.
  - [ ] 7.3 Mover lead (drag-and-drop) → `useMoveLead`; desabilitar sem `crm:pipeline:mover`.
  - [ ] 7.4 Painel de detalhe do lead: dados de contato (Base Central) + timeline.
  - Testes: mover dispara mutation; drag desabilitado sem permissão.
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

- [ ] 8. Empacotamento e nginx
  - [ ] 8.1 `deploy/nginx/hubcentral.conf`: serve `frontend/dist`, `try_files` SPA, reverse proxy `/api` → `127.0.0.1:3000`, TLS-ready (comentado para certbot).
  - [ ] 8.2 Atualizar `scripts/install.sh`: instalar nginx, `npm ci && npm run build` do frontend, publicar dist, aplicar config nginx, recarregar.
  - [ ] 8.3 Atualizar README (seção Frontend + Implantação com nginx) e CHANGELOG; nova release.
  - _Requirements: 6.1, 6.2, 6.3, 6.4_

- [ ] 9. Verificação final
  - `npm run typecheck` + `npm run build` + `npm test` no frontend; revisão de segurança do proxy.
