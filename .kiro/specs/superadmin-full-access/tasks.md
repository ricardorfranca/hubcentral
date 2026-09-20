# Implementation Plan

- [x] 1. Escrever teste exploratório da Bug Condition (ANTES de corrigir)
  - **Property 1: Bug Condition** - SuperAdministrador tem acesso global
  - **CRITICAL**: Este teste DEVE FALHAR no código não corrigido — a falha confirma que o bug existe
  - **DO NOT attempt to fix the test or the code when it fails** nesta etapa
  - **NOTE**: Este teste codifica o comportamento esperado — ele validará a correção quando passar após a implementação (ver tarefa 3.2)
  - **GOAL**: Surfacear contraexemplos que demonstram que o SuperAdministrador é negado sem o namespace concedido
  - **Scoped PBT Approach**: Reaproveitar `namespaceArb` de `tests/iam/rbac.test.ts` para gerar namespaces aleatórios; o helper `newUser` cria usuário não-superadmin, então promover `role = 'superadmin'` explicitamente (`UPDATE core.users SET role = 'superadmin' WHERE id = $1`)
  - Detalhes da Bug Condition (do design): `isBugCondition(input)` = `userId != null AND roleOf(userId) = 'superadmin' AND NOT hasNamespace(userId, requiredNamespace)`
  - Escrever property-based test em `tests/iam/rbac.test.ts` usando `withRollback`: para cada `ns` gerado por `namespaceArb`, criar superadmin SEM nenhum grant e assertir `await expect(authorize(client, userId, ns)).resolves.toBeUndefined()`
  - Cobrir também os casos concretos do design: namespace fora de `ALL_NAMESPACES` (ex.: `crm:novomodulo:acao`) e namespace do catálogo nunca concedido (ex.: `core:backup:gerenciar`)
  - As asserções devem casar com a Expected Behavior Property (autoriza / resolve sem lançar) da Property 1 do design
  - Executar o teste no código NÃO corrigido
  - **EXPECTED OUTCOME**: Teste FALHA lançando `RBAC_ACCESS_DENIED` (correto — prova que o bug existe)
  - Documentar os contraexemplos encontrados (ex.: "authorize(client, superadminId, 'crm:leads:visualizar') lança RBAC_ACCESS_DENIED em vez de resolver")
  - Marcar a tarefa como concluída quando o teste estiver escrito, executado e a falha documentada
  - _Requirements: 2.1, 2.2, 2.3_

- [x] 2. Escrever testes de preservação property-based (ANTES de corrigir)
  - **Property 2: Preservation** - Comportamento de não-superadmin e não autenticados
  - **IMPORTANT**: Seguir a metodologia observation-first — observar o comportamento no código NÃO corrigido antes de escrever as asserções
  - Reaproveitar a estrutura existente da Property 25 em `tests/iam/rbac.test.ts` (mesmos `namespaceArb`, `newUser`, `withRollback`)
  - **Observar (¬C) no código não corrigido e capturar em property-based tests**:
    - Não-superadmin COM o namespace concedido: `authorize(client, userId, granted)` resolve — observar e assertir para todo `granted` (Req 3.1)
    - Não-superadmin SEM o namespace: `authorize(client, userId, other)` lança `RBAC_ACCESS_DENIED` para todo `other != granted` (Req 3.2)
    - Requisição não autenticada: `authorize(client, null, ns)` lança `AUTH_UNAUTHORIZED` para todo `ns` gerado — independentemente do papel hipotético (Req 3.3)
    - Conjunto concedido de não-superadmin: após `grantNamespace`/`revokeNamespace`/`setUserPermissions`, `hasNamespace`/`listUserPermissions` refletem exatamente o conjunto (Req 3.4)
  - Property-based testing gera muitos casos por todo o domínio de namespaces para garantia mais forte de que o comportamento é inalterado
  - Executar os testes no código NÃO corrigido
  - **EXPECTED OUTCOME**: Testes PASSAM (confirma o comportamento baseline a ser preservado)
  - Marcar a tarefa como concluída quando os testes estiverem escritos, executados e passando no código não corrigido
  - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [x] 3. Correção para o acesso global do SuperAdministrador

  - [x] 3.1 Adicionar/promover o helper `isSuperadmin` ao núcleo IAM e inserir o bypass em `authorize`
    - Em `src/core/iam/rbac.ts`, exportar `isSuperadmin(client, userId)`: retorna `false` se `userId` for nulo; caso contrário `SELECT EXISTS (SELECT 1 FROM core.users WHERE id = $1 AND role = 'superadmin')`
    - Em `authorize`, manter a checagem de `userId` nulo lançando `AUTH_UNAUTHORIZED` PRIMEIRO (ordem preservada)
    - Inserir o bypass APÓS a checagem de autenticação e ANTES de `hasNamespace`: `if (await isSuperadmin(client, userId)) return;`
    - Manter a checagem de `hasNamespace` lançando `RBAC_ACCESS_DENIED` como último passo, inalterada para não-superadmin
    - Não alterar assinaturas públicas de `authorize`, `grantNamespace`, `revokeNamespace`, `setUserPermissions`, `listUserPermissions`, `hasNamespace`
    - _Bug_Condition: isBugCondition(input) = userId != null AND roleOf(userId) = 'superadmin' AND NOT hasNamespace(userId, requiredNamespace) (do design)_
    - _Expected_Behavior: expectedBehavior — authorize resolve sem lançar quando isSuperadmin é true (Property 1 do design)_
    - _Preservation: Preservation Requirements do design — ¬C inalterado (não-superadmin, não autenticado, superadmin já com namespace)_
    - _Requirements: 2.1, 2.2, 2.3, 3.3_

  - [x] 3.2 Refatorar (opcional, não regressivo) `project-service.ts` para reusar o helper do núcleo
    - Substituir a `isSuperadmin` privada em `src/modules/projetos/project-service.ts` por `import { isSuperadmin } from "../../core/iam/rbac.js"`
    - Fazer `isSuperadminOrOwner` reutilizar o helper do núcleo onde aplicável, mantendo o mesmo resultado observável
    - Mudança apenas de organização — não altera comportamento; confirmar rodando os testes de `projetos`
    - _Preservation: comportamento observável de project-service inalterado_
    - _Requirements: 2.1, 3.4_

  - [x] 3.3 Verificar que o teste exploratório da Bug Condition agora passa
    - **Property 1: Expected Behavior** - SuperAdministrador tem acesso global
    - **IMPORTANT**: Re-executar o MESMO teste da tarefa 1 — NÃO escrever um novo teste
    - O teste da tarefa 1 codifica o comportamento esperado; quando passa, confirma que a Expected Behavior é satisfeita
    - Executar o teste exploratório da Bug Condition da tarefa 1
    - **EXPECTED OUTCOME**: Teste PASSA (confirma que o bug foi corrigido)
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 3.4 Verificar que os testes de preservação continuam passando
    - **Property 2: Preservation** - Comportamento de não-superadmin e não autenticados
    - **IMPORTANT**: Re-executar os MESMOS testes da tarefa 2 — NÃO escrever novos testes
    - Executar os testes de preservação property-based da tarefa 2 (inclui a Property 25 existente)
    - **EXPECTED OUTCOME**: Testes PASSAM (confirma ausência de regressões)
    - Confirmar que todos os testes continuam passando após a correção
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [-] 4. Testes unitários e de integração complementares
  - Unit (`tests/iam/rbac.test.ts`): `isSuperadmin` retorna `true` para papel superadmin, `false` para outros papéis e `false` para `userId` nulo
  - Unit: `authorize` autoriza superadmin para namespace ausente de `ALL_NAMESPACES` (Req 2.3)
  - Unit: `authorize` recusa `userId` nulo com `AUTH_UNAUTHORIZED` mesmo quando o alvo hipotético seria superadmin (Req 3.3)
  - Integração: criar SuperAdministrador via bootstrap, introduzir um namespace novo (não concedido) e verificar que a rota protegida por esse namespace é autorizada de ponta a ponta (Req 2.1, 2.2)
  - Integração (alternância de papel): rebaixar um SuperAdministrador para papel comum e verificar que a autorização volta a depender de `hasNamespace` (bypass deixa de valer) (Req 3.1, 3.2)
  - Integração (regressão de usuário comum): usuário sem `superadmin` acessa rota com namespace concedido (autorizado) e sem namespace (negado com `RBAC_ACCESS_DENIED`) (Req 3.1, 3.2)
  - _Requirements: 2.1, 2.2, 2.3, 3.1, 3.2, 3.3, 3.4_

- [~] 5. Checkpoint - Garantir que todos os testes passam
  - Executar a suíte completa (`npm test` / `vitest --run`) e garantir que todos os testes passam
  - Confirmar Property 1 (bug corrigido) e Property 2 (sem regressões) verdes
  - Em caso de dúvidas ou falhas inesperadas, perguntar ao usuário
