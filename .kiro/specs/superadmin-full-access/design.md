# SuperAdmin Full Access Bugfix Design

## Overview

O papel `superadmin` deveria conceder acesso global a todo o HUB Central (§2.2 das Instruções gerais). Hoje, `authorize` (`src/core/iam/rbac.ts`) verifica exclusivamente a posse do namespace via `hasNamespace`, sem qualquer bypass para o papel. Assim, os acessos do SuperAdministrador são apenas o retrato de `ALL_NAMESPACES` gravado em `core.user_permissions` no bootstrap (`createAdmin` / `src/cli/create-admin.ts`); qualquer namespace novo passa a ser negado até reconcessão manual.

A estratégia de correção é fazer o bypass no **ponto central de autorização** (`authorize`), que já é atravessado por todas as ações protegidas. Antes de exigir o namespace, `authorize` passará a autorizar incondicionalmente quando o usuário autenticado tiver `role = 'superadmin'`. A verificação de papel será promovida para o núcleo IAM como um helper reutilizável (`isSuperadmin`), em vez de permanecer duplicada e privada dentro de `src/modules/projetos/project-service.ts`. A correção é mínima, cirúrgica e não altera assinaturas públicas nem o caminho de negação para usuários comuns.

## Glossary

- **Bug_Condition (C)**: A condição que dispara o bug — usuário com `role = 'superadmin'` requisita uma ação cujo `requiredNamespace` não lhe foi concedido (`NOT hasNamespace(userId, requiredNamespace)`).
- **Property (P)**: O comportamento desejado sob C — `authorize` deve autorizar (resolver sem lançar), independentemente do conjunto concedido.
- **Preservation**: Comportamento existente que deve permanecer idêntico para entradas em `¬C` — usuários não-superadmin e requisições não autenticadas seguem o caminho atual de `hasNamespace` / `AUTH_UNAUTHORIZED`.
- **`authorize`**: Função em `src/core/iam/rbac.ts` que autoriza uma ação; lança `AUTH_UNAUTHORIZED` se `userId` for nulo e `RBAC_ACCESS_DENIED` se faltar o namespace. É o ponto central atravessado por todas as ações protegidas.
- **`hasNamespace`**: Função em `src/core/iam/rbac.ts` que verifica se o usuário possui um namespace específico em `core.user_permissions`.
- **`isSuperadmin`**: Novo helper no núcleo IAM (`src/core/iam/rbac.ts`) que consulta `core.users` e retorna `true` sse `role = 'superadmin'`. Consolida a lógica hoje privada em `project-service.ts`.
- **`role`**: Coluna de `core.users` com CHECK constraint incluindo `'superadmin'` (migration `1737000014000`).
- **`ALL_NAMESPACES`**: Catálogo em `src/core/iam/namespaces.ts` usado no bootstrap para conceder namespaces um a um ao SuperAdministrador.

## Bug Details

### Bug Condition

O bug se manifesta quando um usuário autenticado com `role = 'superadmin'` requisita uma ação cujo namespace exigido não consta entre os que lhe foram concedidos em `core.user_permissions`. Nesse caso, `authorize` chama `hasNamespace`, obtém `false` e lança `RBAC_ACCESS_DENIED`, tratando o SuperAdministrador como um usuário comum — sem o acesso global previsto para o papel.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type { userId: string, requiredNamespace: string }
  OUTPUT: boolean

  RETURN input.userId IS NOT null
         AND roleOf(input.userId) = 'superadmin'
         AND NOT hasNamespace(input.userId, input.requiredNamespace)
END FUNCTION
```

### Examples

- **Namespace novo após o bootstrap**: Um SuperAdministrador criado antes da introdução de `projetos:notificacoes:visualizar` requisita esse namespace. Esperado: autorizado (acesso global). Atual: `RBAC_ACCESS_DENIED`.
- **Namespace ausente de `ALL_NAMESPACES`**: Uma rota exige `crm:novomodulo:acao`, ainda não catalogado. Esperado: SuperAdministrador autorizado. Atual: negado mesmo para SuperAdministrador recém-criado.
- **Namespace nunca concedido**: SuperAdministrador cujo bootstrap não incluiu `core:backup:gerenciar` tenta gerenciar backup. Esperado: autorizado. Atual: negado até reconcessão manual.
- **Edge case (SuperAdministrador com namespace concedido)**: SuperAdministrador requisita `crm:leads:visualizar`, que lhe foi concedido. `NOT C` (o namespace existe); tanto hoje quanto após a correção o acesso é autorizado — resultado idêntico.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Usuários **sem** `role = 'superadmin'` que possuem o namespace exigido continuam autorizados (via `hasNamespace`).
- Usuários **sem** `role = 'superadmin'` que **não** possuem o namespace exigido continuam negados com `RBAC_ACCESS_DENIED`.
- Requisições não autenticadas (`userId` nulo) continuam recusadas com `AUTH_UNAUTHORIZED`, independentemente do papel, e essa checagem permanece **antes** de qualquer consulta de papel.
- `grantNamespace`, `revokeNamespace`, `setUserPermissions`, `listUserPermissions` e `hasNamespace` mantêm assinatura e comportamento — o conjunto refletido em `core.user_permissions` para usuários comuns permanece exato.

**Scope:**
Todas as entradas que **não** satisfazem a Bug Condition (`¬C`) devem permanecer completamente inalteradas por esta correção. Isso inclui:
- Usuários comuns (qualquer `role != 'superadmin'`), autorizados ou negados.
- Requisições não autenticadas (`userId` nulo).
- SuperAdministradores que **já** possuem o namespace exigido (resultado autorizado idêntico ao atual).

**Note:** O comportamento correto esperado sob a Bug Condition está definido na seção Correctness Properties (Property 1). Esta seção foca no que **não** deve mudar.

## Hypothesized Root Cause

Com base na análise do bug e na leitura de `src/core/iam/rbac.ts`, a causa raiz é:

1. **Ausência de bypass de papel em `authorize`**: A função decide unicamente por `hasNamespace(userId, namespace)`. Não há ramo que trate `role = 'superadmin'` como acesso global. Esta é a causa raiz confirmada pela leitura do código.

2. **Acesso do SuperAdministrador é estático**: Os namespaces vêm de `createAdmin` concedendo `ALL_NAMESPACES` um a um no bootstrap. Qualquer namespace introduzido depois (novo módulo ou rota) fica fora do conjunto congelado.

3. **Lógica de papel fora do núcleo**: A verificação de `role = 'superadmin'` existe apenas como função privada em `src/modules/projetos/project-service.ts` (`isSuperadmin` / `isSuperadminOrOwner`), inacessível ao núcleo IAM. O núcleo, que é o ponto central de autorização, não dispõe de um meio reutilizável de checar o papel.

## Correctness Properties

Property 1: Bug Condition - SuperAdministrador tem acesso global

_For any_ input onde a bug condition se mantém (`isBugCondition` retorna `true` — usuário autenticado com `role = 'superadmin'` e sem o namespace exigido), a função `authorize` corrigida SHALL autorizar a ação (resolver sem lançar), independentemente do conjunto de namespaces concedido em `core.user_permissions`.

**Validates: Requirements 2.1, 2.2, 2.3**

Property 2: Preservation - Comportamento de não-superadmin e não autenticados

_For any_ input onde a bug condition NÃO se mantém (`isBugCondition` retorna `false` — usuário não-superadmin, requisição não autenticada, ou superadmin que já possui o namespace), a função `authorize` corrigida SHALL produzir exatamente o mesmo resultado da função original: autoriza sse o usuário possui o namespace, nega com `RBAC_ACCESS_DENIED` quando falta, e recusa com `AUTH_UNAUTHORIZED` quando `userId` é nulo.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4**

## Fix Implementation

### Changes Required

Assumindo que a análise de causa raiz está correta:

**File**: `src/core/iam/rbac.ts`

**Function**: `authorize` (com adição do helper `isSuperadmin`)

**Specific Changes**:
1. **Adicionar helper `isSuperadmin` ao núcleo IAM**: Exportar `isSuperadmin(client, userId)` em `rbac.ts`, consolidando a consulta hoje privada em `project-service.ts`:
   ```
   FUNCTION isSuperadmin(client, userId)
     IF userId IS null THEN RETURN false
     RETURN EXISTS (SELECT 1 FROM core.users WHERE id = userId AND role = 'superadmin')
   END FUNCTION
   ```
   Retorna `false` para `userId` nulo, preservando a precedência da checagem de autenticação.

2. **Inserir bypass em `authorize`**: Após a checagem de `userId` nulo (mantida como está, lançando `AUTH_UNAUTHORIZED`) e **antes** da checagem de `hasNamespace`, autorizar incondicionalmente se `isSuperadmin(client, userId)` for `true`:
   ```
   IF NOT userId THEN throw AUTH_UNAUTHORIZED
   IF await isSuperadmin(client, userId) THEN return   // bypass de acesso global
   IF NOT await hasNamespace(client, userId, namespace) THEN throw RBAC_ACCESS_DENIED
   ```

3. **Preservar a ordem das checagens**: A recusa por falta de autenticação permanece primeiro; assim `userId` nulo nunca chega à consulta de papel (Req 3.3).

4. **Refatorar `project-service.ts` (opcional, não regressivo)**: Substituir a `isSuperadmin` privada por `import { isSuperadmin } from "../../core/iam/rbac.js"` para eliminar a duplicação. `isSuperadminOrOwner` pode reutilizar o helper do núcleo. Esta mudança é de organização e não altera comportamento observável.

5. **Sem mudanças em assinaturas públicas**: `authorize` mantém `(client, userId, namespace)`. `grantNamespace`, `revokeNamespace`, `setUserPermissions`, `listUserPermissions`, `hasNamespace` permanecem intactos.

## Testing Strategy

### Validation Approach

A estratégia segue duas fases: primeiro, surfaces contraexemplos que demonstram o bug no código NÃO corrigido; depois, verifica que a correção funciona e preserva o comportamento existente. Os testes seguem as convenções em `tests/iam/rbac.test.ts` (vitest + fast-check + `withRollback` para isolar transações). Note que `newUser` cria usuários com o papel padrão (não-superadmin); testes de superadmin devem inserir/atualizar `role = 'superadmin'` explicitamente.

### Exploratory Bug Condition Checking

**Goal**: Surfaces contraexemplos que demonstram o bug ANTES de implementar a correção. Confirmar ou refutar a análise de causa raiz. Se refutarmos, re-hipotetizar.

**Test Plan**: Criar um usuário com `role = 'superadmin'` sem conceder o namespace requisitado e chamar `authorize`, asserindo que resolve. Executar no código NÃO corrigido para observar a falha (`RBAC_ACCESS_DENIED`) e confirmar que a ausência de bypass em `authorize` é a causa raiz.

**Test Cases**:
1. **Superadmin sem namespace concedido**: `role = 'superadmin'`, nenhum grant, `authorize(client, userId, 'crm:leads:visualizar')` (falhará no código não corrigido).
2. **Superadmin e namespace fora de `ALL_NAMESPACES`**: `authorize(client, userId, 'crm:novomodulo:acao')` (falhará no código não corrigido).
3. **Superadmin sem um namespace específico do catálogo**: concede um subconjunto e requisita um namespace ausente (falhará no código não corrigido).
4. **Edge case (superadmin com o namespace)**: concede o namespace e requisita o mesmo — deve passar tanto antes quanto depois (não é contraexemplo).

**Expected Counterexamples**:
- `authorize` lança `RBAC_ACCESS_DENIED` para um superadmin quando o namespace não foi concedido.
- Causa provável confirmada: `authorize` não possui ramo de bypass para `role = 'superadmin'`.

### Fix Checking

**Goal**: Verificar que, para toda entrada onde a bug condition se mantém, `authorize` corrigida produz o comportamento esperado (autoriza).

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  result := authorize_fixed(input.client, input.userId, input.requiredNamespace)
  ASSERT result resolves (no throw)   // expectedBehavior
END FOR
```

### Preservation Checking

**Goal**: Verificar que, para toda entrada onde a bug condition NÃO se mantém, `authorize` corrigida produz o mesmo resultado da original.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT authorize_original(input) = authorize_fixed(input)
END FOR
```

**Testing Approach**: Testes property-based são recomendados para a preservação porque:
- Geram muitos casos automaticamente por todo o domínio de namespaces (o `namespaceArb` existente serve de base).
- Capturam edge cases que testes manuais poderiam perder.
- Oferecem garantia forte de que o comportamento é inalterado para todas as entradas não-buggy.

**Test Plan**: Observar o comportamento no código NÃO corrigido para usuários comuns e requisições não autenticadas, então escrever testes property-based que capturam esse comportamento e reexecutá-los após a correção.

**Test Cases**:
1. **Não-superadmin com namespace**: observar que autoriza no código não corrigido; verificar que continua autorizando após a correção (Req 3.1).
2. **Não-superadmin sem namespace**: observar `RBAC_ACCESS_DENIED` no código não corrigido; verificar que continua negando após a correção (Req 3.2).
3. **Não autenticado (`userId` nulo)**: observar `AUTH_UNAUTHORIZED` no código não corrigido; verificar que continua recusando após a correção, independentemente do papel (Req 3.3).
4. **Conjunto concedido de não-superadmin**: observar que `hasNamespace` reflete exatamente o conjunto após grant/revoke/replace; verificar preservação exata após a correção (Req 3.4).

### Unit Tests

- `authorize` autoriza superadmin sem o namespace concedido (Property 1 / Req 2.1, 2.2, 2.3).
- `authorize` autoriza superadmin para namespace ausente de `ALL_NAMESPACES` (Req 2.3).
- `authorize` recusa `userId` nulo com `AUTH_UNAUTHORIZED` mesmo quando o alvo hipotético seria superadmin (Req 3.3).
- `isSuperadmin` retorna `true` para papel superadmin, `false` para outros papéis e `false` para `userId` nulo.

### Property-Based Tests

- **Property 1 (Bug Condition)**: para namespaces aleatórios (`namespaceArb`), um usuário com `role = 'superadmin'` e sem grant é sempre autorizado por `authorize`.
- **Property 2 (Preservation)**: para namespaces `granted != other` aleatórios, um usuário não-superadmin é autorizado sse possui o namespace e negado (`RBAC_ACCESS_DENIED`) caso contrário — reaproveitando a estrutura do teste existente da Property 25.
- **Property 2 (Preservation, não autenticado)**: para namespaces aleatórios, `authorize(client, null, ns)` sempre lança `AUTH_UNAUTHORIZED`.

### Integration Tests

- Fluxo completo: criar SuperAdministrador via bootstrap, introduzir um namespace novo (não concedido) e verificar que uma rota protegida por esse namespace é autorizada de ponta a ponta.
- Alternância de papel: rebaixar um SuperAdministrador para papel comum e verificar que a autorização volta a depender de `hasNamespace` (bypass deixa de valer).
- Regressão de usuário comum: usuário sem `superadmin` acessa rota com namespace concedido (autorizado) e sem namespace (negado com `RBAC_ACCESS_DENIED`).
