# Bugfix Requirements Document

## Introduction

Um usuário com `role = 'superadmin'` deveria ter acesso global a todas as funcionalidades do HUB Central, conforme o §2.2 das Instruções gerais ("SuperAdministrador — Acesso global"). Na prática, o SuperAdministrador só possui os acessos que lhe foram concedidos explicitamente no momento do bootstrap.

A causa raiz é que a autorização (`authorize` em `src/core/iam/rbac.ts`) verifica apenas se o usuário possui o namespace concedido (`hasNamespace`), sem nenhum bypass para o papel `superadmin`. Os acessos do SuperAdministrador vêm exclusivamente do `createAdmin` (`src/cli/create-admin.ts`), que concede, um a um, os namespaces listados em `ALL_NAMESPACES` (`src/core/iam/namespaces.ts`) no instante da criação.

Como consequência, o conjunto de permissões do SuperAdministrador é um retrato congelado de `ALL_NAMESPACES` no momento em que ele foi criado. Qualquer namespace novo — introduzido por um novo módulo ou por uma rota que exige um namespace ainda ausente de `ALL_NAMESPACES` — passa a ser negado ao SuperAdministrador, exigindo reconcessão manual. Isso contradiz a definição de "acesso global" e é a origem do relato do usuário.

## Bug Analysis

### Current Behavior (Defect)

O que acontece hoje quando o bug é acionado: a autorização trata o SuperAdministrador como qualquer outro usuário, dependendo do conjunto de namespaces gravado em `core.user_permissions` no momento do bootstrap.

1.1 WHEN um usuário com `role = 'superadmin'` requisita uma ação cujo namespace exigido NÃO consta entre os que lhe foram concedidos no bootstrap THEN o sistema nega o acesso com `RBAC_ACCESS_DENIED`

1.2 WHEN um novo namespace/módulo é adicionado a `ALL_NAMESPACES` APÓS a criação de um SuperAdministrador existente THEN o sistema mantém esse SuperAdministrador sem a nova permissão até que ocorra reconcessão manual

1.3 WHEN uma rota exige um namespace que ainda não foi incluído em `ALL_NAMESPACES` THEN o sistema nega o acesso mesmo a um SuperAdministrador recém-criado

### Expected Behavior (Correct)

O que deveria acontecer: o papel `superadmin` deve garantir acesso global a qualquer namespace, independentemente do conjunto explicitamente concedido.

2.1 WHEN um usuário com `role = 'superadmin'` requisita uma ação cujo namespace exigido NÃO consta entre os que lhe foram concedidos THEN o sistema SHALL autorizar a ação

2.2 WHEN um novo namespace/módulo é adicionado APÓS a criação de um SuperAdministrador existente THEN o sistema SHALL autorizar esse SuperAdministrador para o novo namespace sem reconcessão manual

2.3 WHEN uma rota exige um namespace que ainda não consta em `ALL_NAMESPACES` THEN o sistema SHALL autorizar um usuário com `role = 'superadmin'` para essa ação

### Unchanged Behavior (Regression Prevention)

Comportamento existente que deve ser preservado para entradas que não acionam o bug (usuários que não são SuperAdministrador).

3.1 WHEN um usuário SEM `role = 'superadmin'` possui o namespace exigido THEN o sistema SHALL CONTINUE TO autorizar a ação

3.2 WHEN um usuário SEM `role = 'superadmin'` NÃO possui o namespace exigido THEN o sistema SHALL CONTINUE TO negar a ação com `RBAC_ACCESS_DENIED`

3.3 WHEN a requisição não está autenticada (`userId` nulo) THEN o sistema SHALL CONTINUE TO recusar com `AUTH_UNAUTHORIZED`, independentemente do papel

3.4 WHEN um usuário SEM `role = 'superadmin'` tem seus namespaces concedidos, revogados ou substituídos THEN o sistema SHALL CONTINUE TO refletir exatamente o conjunto concedido em `core.user_permissions`
