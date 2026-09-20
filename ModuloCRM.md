# ModuloCRM.md — Especificação do Módulo de CRM

**Sistema:** HUB Central  
**Módulo:** `mod_crm`  
**Versão:** `1.0.0`  
**Status:** Em desenvolvimento  
**Escopo de uso:** Interno — equipe comercial e de marketing  
**Autor da spec:** Gerado a partir das regras de negócio implementadas no protótipo Vibecode CRM  

---

## 1. Visão Geral do Módulo

O **Módulo CRM** é um subsistema nativo do HUB Central responsável pela gestão completa do ciclo de vida de leads e oportunidades comerciais da empresa. Cobre desde a captura do lead até o fechamento (ganho ou perdido), com controle de SLA em tempo real, pipeline visual em Kanban, comunicação interna entre a equipe e disparo de campanhas de marketing.

### 1.1 Responsabilidades

- Captura e qualificação de leads (manual ou via integração externa)
- Gestão visual do pipeline de vendas em colunas Kanban
- Controle de SLA por etapa com alertas automáticos e memória de tempo
- Comunicação interna entre usuários (mensagens diretas e canal de equipe)
- Gestão de campanhas de e-mail segmentadas por etiquetas
- Relatórios operacionais e de performance comercial
- Disparo de alertas de SLA para vendedor responsável e gerentes

### 1.2 Posicionamento no HUB Central

```
HUB Central (core)
└── mod_crm
    ├── Pipeline & Leads
    ├── Campanhas
    ├── Relatórios
    ├── Conversas (Mensageria interna)
    └── Configurações do Módulo
```

---

## 2. Contrato com o HUB Central

### 2.1 Registro do Módulo

O módulo se registra no HUB Central declarando:

```json
{
  "module_id": "mod_crm",
  "display_name": "CRM Comercial",
  "schema": "mod_crm",
  "version": "1.0.0",
  "config_panel": true,
  "has_export": true,
  "has_import": true,
  "emits_events": true,
  "requires_core_tables": ["core.users"]
}
```

### 2.2 Identidade e Autenticação

- Toda autenticação e gestão de sessão é delegada ao **IAM centralizado do HUB Central** (`core.users`).
- O módulo **não mantém tabela própria de usuários**. Todos os usuários que interagem com o CRM existem em `core.users` e são referenciados via `user_id` (UUID).
- O CRM declara os **namespaces de permissão RBAC** (Seção 3), mas a atribuição de permissões a usuários é responsabilidade exclusiva do **Administrador de Módulo** ou **SuperAdministrador** via painel IAM do HUB Central.

### 2.3 Customização Visual

Toda customização visual (logotipo, paleta de cores, nome do sistema, cor da sidebar) é gerenciada pelo painel de **Branding do SuperAdministrador** do HUB Central, conforme Seção 4.3 da arquitetura central. O módulo CRM **não mantém configurações visuais próprias**; consome o Theme Provider global.

### 2.4 Logs de Auditoria

Todas as ações relevantes do módulo são gravadas em `core.system_logs` com o campo `module = 'crm'`. O módulo **nunca grava logs em tabelas próprias** — toda auditoria passa pelo barramento de logs do HUB Central.

Ações auditadas obrigatoriamente:

| `action`                  | Descrição                                    |
|---------------------------|----------------------------------------------|
| `CRM_LEAD_CRIADO`         | Novo lead cadastrado                         |
| `CRM_LEAD_MOVIDO`         | Lead movido entre etapas do pipeline         |
| `CRM_LEAD_GANHO`          | Lead finalizado como ganho                   |
| `CRM_LEAD_PERDIDO`        | Lead finalizado como perdido                 |
| `CRM_LEAD_DESCARTADO`     | Lead descartado (suave ou definitivo)        |
| `CRM_SLA_CRITICO`         | SLA de um lead entrou em estado crítico      |
| `CRM_ALERTA_ENVIADO`      | Gerente enviou alerta ao vendedor pelo lead  |
| `CRM_CAMPANHA_CRIADA`     | Nova campanha de marketing criada            |
| `CRM_CAMPANHA_DISPARADA`  | Campanha disparada para leads               |
| `CRM_CONFIG_SLA_ALTERADA` | Configuração de SLA alterada                |
| `CRM_CANAL_CONFIGURADO`   | Canal de comunicação configurado            |
| `CRM_INTEGRACAO_SALVA`    | Credencial de integração salva              |

---

## 3. Permissões RBAC — Namespaces do Módulo

O módulo declara os seguintes namespaces de permissão no formato `[modulo]:[recurso]:[acao]` para gestão via HUB Central:

### 3.1 Leads

| Namespace                        | Descrição                                        |
|----------------------------------|--------------------------------------------------|
| `crm:leads:visualizar`           | Ver lista de leads e detalhes                    |
| `crm:leads:visualizar_proprios`  | Ver apenas leads atribuídos ao próprio usuário   |
| `crm:leads:criar`                | Cadastrar novo lead                              |
| `crm:leads:editar`               | Editar dados de um lead existente                |
| `crm:leads:descartar_suave`      | Descarte suave (sem interesse — reativável)      |
| `crm:leads:descartar_definitivo` | Descarte definitivo (fora de perfil)             |
| `crm:leads:exportar`             | Exportar lista de leads (CSV/XLSX)               |
| `crm:leads:importar`             | Importar leads via arquivo                       |

### 3.2 Pipeline

| Namespace                          | Descrição                                       |
|------------------------------------|-------------------------------------------------|
| `crm:pipeline:visualizar`          | Visualizar o Kanban completo                    |
| `crm:pipeline:visualizar_proprios` | Visualizar apenas leads próprios no Kanban      |
| `crm:pipeline:mover`               | Mover leads entre etapas (drag-and-drop)        |
| `crm:pipeline:finalizar`           | Mover lead para Ganho ou Perdido                |
| `crm:pipeline:enviar_alerta`       | Enviar alerta ao vendedor a partir de um lead   |

### 3.3 Dashboard

| Namespace                          | Descrição                                            |
|------------------------------------|------------------------------------------------------|
| `crm:dashboard:visualizar_proprio` | Ver indicadores apenas dos próprios leads            |
| `crm:dashboard:visualizar_equipe`  | Ver indicadores de toda a equipe                     |
| `crm:dashboard:visualizar_financeiro` | Ver valores monetários (ativação e mensalidade)  |
| `crm:dashboard:relatorio_perda`    | Acessar relatório de motivos de perda pelo dashboard |

### 3.4 Campanhas

| Namespace                    | Descrição                                    |
|------------------------------|----------------------------------------------|
| `crm:campanhas:visualizar`   | Ver campanhas existentes                     |
| `crm:campanhas:criar`        | Criar nova campanha                          |
| `crm:campanhas:editar`       | Editar campanha existente                    |
| `crm:campanhas:disparar`     | Disparar campanha para leads segmentados     |
| `crm:campanhas:teste`        | Disparar e-mail de teste de uma campanha     |

### 3.5 Relatórios

| Namespace                         | Descrição                                       |
|-----------------------------------|-------------------------------------------------|
| `crm:relatorios:semanal`          | Acessar relatório semanal de atividades         |
| `crm:relatorios:descartados`      | Acessar relatório de leads descartados          |
| `crm:relatorios:motivos_perda`    | Acessar relatório de motivos de perda           |
| `crm:relatorios:fechamentos`      | Acessar relatório de fechamentos do mês         |
| `crm:relatorios:performance`      | Acessar relatório de performance por vendedor   |
| `crm:relatorios:sla`              | Acessar relatório de cumprimento de SLA         |
| `crm:relatorios:exportar`         | Exportar qualquer relatório (CSV/XLSX)          |

### 3.6 Conversas (Mensageria Interna)

| Namespace                         | Descrição                                       |
|-----------------------------------|-------------------------------------------------|
| `crm:conversas:visualizar`        | Acessar aba de conversas                        |
| `crm:conversas:enviar_mensagem`   | Enviar mensagem direta ou no canal da equipe    |
| `crm:conversas:enviar_alerta`     | Enviar alerta vinculado a um lead               |

### 3.7 Configurações do Módulo

| Namespace                              | Descrição                                         |
|----------------------------------------|---------------------------------------------------|
| `crm:config:sla`                       | Alterar configurações de SLA por etapa            |
| `crm:config:listas`                    | Gerenciar listas (etiquetas, origens, produtos…)  |
| `crm:config:canais`                    | Configurar canais de comunicação                  |
| `crm:config:integracoes`               | Configurar integrações externas                   |
| `crm:config:personalização`            | Acessar personalização visual via HUB             |
| `crm:config:usuarios:criar`            | Convidar novo usuário ao módulo CRM               |
| `crm:config:usuarios:editar_dados`     | Editar nome, e-mail e telefone de usuários        |
| `crm:config:usuarios:alterar_perfil`   | Alterar o perfil/nível RBAC de um usuário         |

### 3.8 Mapeamento de Perfis Operacionais Sugeridos

Os perfis a seguir são sugeridos como ponto de partida no provisionamento, mas **toda atribuição real é feita pelo HUB Central**:

| Perfil Sugerido | Namespaces concedidos |
|---|---|
| **Gerente** | Todos de leads, pipeline, dashboard (sem financeiro), relatórios, conversas, `crm:config:sla`, `crm:config:listas`, `crm:config:usuarios:editar_dados` |
| **Vendedor** | `crm:leads:visualizar_proprios`, `crm:leads:criar`, `crm:leads:editar`, `crm:pipeline:visualizar_proprios`, `crm:pipeline:mover`, `crm:dashboard:visualizar_proprio`, `crm:conversas:*` |
| **Marketing** | `crm:leads:visualizar`, `crm:campanhas:*`, `crm:dashboard:visualizar_proprio`, `crm:relatorios:motivos_perda`, `crm:conversas:*`, `crm:config:canais`, `crm:config:integracoes` |

> **Regra:** O perfil Marketing **nunca** pode ser atribuído como vendedor responsável em um lead. Esta validação é feita na camada de negócio do módulo, independentemente das permissões RBAC.

---

## 4. Modelo de Dados — Schema `mod_crm`

### 4.1 `mod_crm.leads`

| Coluna           | Tipo             | Regras                                                                 |
|------------------|------------------|------------------------------------------------------------------------|
| `id`             | UUID PK          | Gerado automaticamente                                                 |
| `name`           | VARCHAR(200)     | Obrigatório. Nome e sobrenome do lead                                  |
| `company`        | VARCHAR(200)     | Obrigatório                                                            |
| `email`          | VARCHAR(254)     | Obrigatório. Validado por regex (RFC 5322 simplificado)                |
| `phone`          | VARCHAR(20)      | Obrigatório. Armazenado com DDI +55. Valida DDD + 8 ou 9 dígitos      |
| `source`         | VARCHAR(100)     | Obrigatório. FK para `mod_crm.lists` (tipo: origem)                   |
| `product`        | VARCHAR(100)     | Obrigatório. FK para `mod_crm.lists` (tipo: produto)                  |
| `assigned_to`    | UUID             | Obrigatório. FK `core.users`. Não pode ser usuário com perfil Marketing|
| `column_id`      | VARCHAR(50)      | Etapa atual no pipeline. Ver Seção 5.1                                 |
| `partner`        | VARCHAR(100)     | FK para `mod_crm.lists` (tipo: parceiro). Opcional                     |
| `tags`           | TEXT[]           | Array de etiquetas. Mínimo 1 obrigatório no cadastro                   |
| `notes`          | TEXT             | Anotações livres                                                       |
| `sla_deadline`   | TIMESTAMPTZ      | Timestamp absoluto de vencimento do SLA da etapa atual. NULL se sem SLA|
| `sla_history`    | JSONB            | Mapa `{ column_id: sla_deadline_timestamp }` para memória de SLA       |
| `value_activation`| DECIMAL(12,2)  | Valor de ativação (preenchido ao ganhar lead)                          |
| `value_monthly`  | DECIMAL(12,2)    | Valor de mensalidade (preenchido ao ganhar lead)                       |
| `loss_reason`    | VARCHAR(200)     | Motivo da perda. FK para `mod_crm.lists` (tipo: motivo_perda)         |
| `discard_type`   | ENUM             | `soft` (sem interesse, reativável) ou `hard` (fora de perfil)          |
| `status`         | ENUM             | `active`, `won`, `lost`, `discarded`                                   |
| `created_by`     | UUID             | FK `core.users`                                                        |
| `created_at`     | TIMESTAMPTZ      | Automático                                                             |
| `updated_at`     | TIMESTAMPTZ      | Automático                                                             |

### 4.2 `mod_crm.lead_timeline`

Registro imutável de todas as ações sobre um lead.

| Coluna       | Tipo        | Descrição                                            |
|--------------|-------------|------------------------------------------------------|
| `id`         | UUID PK     |                                                      |
| `lead_id`    | UUID FK     | FK `mod_crm.leads`                                   |
| `user_id`    | UUID FK     | FK `core.users`. `SYSTEM` para alertas automáticos   |
| `user_name`  | VARCHAR(200)| Nome snapshot do autor (preservado mesmo se deletado)|
| `action_type`| ENUM        | `stage`, `note`, `status`, `info`, `success`, `error`|
| `text`       | TEXT        | Descrição legível da ação                            |
| `timestamp`  | TIMESTAMPTZ | Automático                                           |

### 4.3 `mod_crm.campaigns`

| Coluna      | Tipo        | Descrição                                              |
|-------------|-------------|--------------------------------------------------------|
| `id`        | UUID PK     |                                                        |
| `name`      | VARCHAR(200)| Nome da campanha                                       |
| `tags`      | TEXT[]      | Etiquetas alvo para segmentação de leads               |
| `channels`  | TEXT[]      | Canais de disparo: `email`, `whatsapp`, `sms`          |
| `status`    | ENUM        | `draft`, `active`, `paused`                            |
| `subject`   | TEXT        | Assunto do e-mail                                      |
| `body_type` | ENUM        | `text` ou `html`                                       |
| `body_text` | TEXT        | Corpo em texto puro (armazenado separadamente)         |
| `body_html` | TEXT        | Corpo em HTML (armazenado separadamente)               |
| `created_by`| UUID FK     | FK `core.users`                                        |
| `created_at`| TIMESTAMPTZ |                                                        |
| `updated_at`| TIMESTAMPTZ |                                                        |

### 4.4 `mod_crm.messages`

Mensagens internas do canal de conversas (equipe e DMs).

| Coluna            | Tipo        | Descrição                                                      |
|-------------------|-------------|----------------------------------------------------------------|
| `id`              | UUID PK     |                                                                |
| `from_user_id`    | UUID FK     | FK `core.users`. UUID `00000000-...` para mensagens do Sistema |
| `from_user_name`  | VARCHAR(200)| Snapshot do nome                                               |
| `from_user_role`  | VARCHAR(100)| Snapshot do perfil do remetente                                |
| `conversation_id` | VARCHAR(100)| `group` para canal da equipe; `dm_{min_id}_{max_id}` para DMs |
| `text`            | TEXT        | Conteúdo da mensagem                                           |
| `type`            | ENUM        | `message`, `sla_alert`, `system`                               |
| `lead_id`         | UUID FK     | Opcional. Vincula alerta a um lead específico                  |
| `timestamp`       | TIMESTAMPTZ | Automático                                                     |

### 4.5 `mod_crm.lists`

Listas configuráveis que alimentam dropdowns e campos de seleção.

| Coluna  | Tipo        | Descrição                                                               |
|---------|-------------|-------------------------------------------------------------------------|
| `id`    | UUID PK     |                                                                         |
| `type`  | ENUM        | `tag`, `source`, `product`, `partner`, `loss_reason`                    |
| `value` | VARCHAR(200)|                                                                         |
| `active`| BOOLEAN     | Default `true`. Itens desativados não aparecem em novos cadastros        |

### 4.6 `mod_crm.sla_config`

| Coluna      | Tipo        | Descrição                                                       |
|-------------|-------------|-----------------------------------------------------------------|
| `column_id` | VARCHAR(50) | PK. Identificador da etapa do pipeline                          |
| `value`     | INTEGER     | Valor numérico do SLA (ex: 30, 7)                               |
| `unit`      | ENUM        | `minutes`, `hours`, `days`                                      |
| `updated_by`| UUID FK     | FK `core.users`                                                 |
| `updated_at`| TIMESTAMPTZ |                                                                 |

### 4.7 `mod_crm.channel_config`

| Coluna       | Tipo         | Descrição                                                      |
|--------------|--------------|----------------------------------------------------------------|
| `channel_id` | VARCHAR(50)  | PK. Ex: `email`, `whatsapp`, `3cx`, `sms`                     |
| `config`     | JSONB        | Credenciais e parâmetros (criptografados em repouso)           |
| `status`     | ENUM         | `not_configured`, `configured`, `error`                        |
| `updated_by` | UUID FK      | FK `core.users` (deve ter perfil SuperAdministrador no HUB)    |
| `updated_at` | TIMESTAMPTZ  |                                                                |

### 4.8 `mod_crm.integration_config`

| Coluna            | Tipo         | Descrição                                               |
|-------------------|--------------|---------------------------------------------------------|
| `integration_id`  | VARCHAR(50)  | PK. Ex: `landing_page_api`, `n8n`, `user_base_sync`    |
| `config`          | JSONB        | Credenciais e endpoints (criptografados em repouso)     |
| `status`          | ENUM         | `not_configured`, `configured`, `error`                 |
| `updated_by`      | UUID FK      | FK `core.users` (deve ser SuperAdministrador no HUB)    |
| `updated_at`      | TIMESTAMPTZ  |                                                         |

---

## 5. Regras de Negócio

### 5.1 Pipeline — Etapas e Fluxo

O pipeline é composto por **7 etapas fixas** em ordem sequencial. As etapas terminais (`won`, `lost`) não aceitam novos movimentos de drag-and-drop.

| `column_id`       | Rótulo exibido          | SLA padrão | Tipo     |
|-------------------|-------------------------|------------|----------|
| `novo`            | Novo Lead               | —          | Ativa    |
| `ligacao`         | Ligação Inicial         | 30 min     | Ativa    |
| `proposta`        | Proposta Preliminar     | 30 min     | Ativa    |
| `reuniao`         | Reunião de Fechamento   | 7 dias     | Ativa    |
| `acompanhamento`  | Acompanhamento          | —          | Ativa    |
| `ganho`           | Concluído — Ganho       | —          | Terminal |
| `perdido`         | Concluído — Perdido     | —          | Terminal |

**Regras de movimentação:**
- Qualquer etapa ativa pode ir para qualquer outra etapa ativa via drag-and-drop.
- Ao arrastar para `ganho`: obrigatório preencher valor de ativação e valor de mensalidade.
- Ao arrastar para `perdido`: obrigatório selecionar motivo da perda.
- Movimento para terminal registra o evento em `mod_crm.lead_timeline` e em `core.system_logs`.
- Dentro de cada coluna, leads são ordenados pelo SLA mais urgente (menor tempo restante) no topo.

### 5.2 Sistema de SLA

#### 5.2.1 Cálculo e Armazenamento

- O SLA de uma etapa é armazenado como **timestamp absoluto** (`sla_deadline`) no registro do lead.
- Ao mover o lead para uma etapa com SLA configurado:
  - Verifica-se `sla_history[column_id]` (ver Seção 5.2.3).
  - Se houver memória → restaura o deadline salvo anteriormente.
  - Se não houver memória → `sla_deadline = NOW() + SLA configurado da etapa`.
- Etapas sem SLA configurado: `sla_deadline = NULL`.
- O tempo restante é calculado em tempo real: `remaining_ms = sla_deadline - NOW()`.
- Atualização de UI a cada **30 segundos**.

#### 5.2.2 Níveis de Urgência

Calculado como percentual do tempo total configurado para a etapa:

| Nível      | Condição               | Cor   |
|------------|------------------------|-------|
| `ok`       | Restante > 50%         | Verde |
| `warning`  | Restante entre 25–50%  | Amarelo|
| `critical` | Restante < 25% ou vencido | Vermelho |

#### 5.2.3 Memória de SLA entre Etapas

Ao **sair** de uma etapa, o `sla_deadline` atual é salvo em `sla_history[column_id]`. Ao **retornar** para a mesma etapa, o deadline salvo é restaurado — o SLA **não reinicia** do zero. Isso garante que um lead que quase venceu o SLA continue urgente ao retornar.

#### 5.2.4 Alteração de Configuração de SLA

Ao alterar o SLA de uma etapa via painel de configurações:

- Para cada lead ativo nessa etapa:
  - Se `tempo_restante > novo_total`: `sla_deadline` é reduzido para `NOW() + novo_total`.
  - Se `tempo_restante ≤ novo_total`: `sla_deadline` é mantido (lead continua com contagem atual).
- Alteração registrada em `core.system_logs` com `action = 'CRM_CONFIG_SLA_ALTERADA'`.

#### 5.2.5 Exibição para Reunião de Fechamento (7 dias)

| Situação                  | Formato exibido             |
|---------------------------|-----------------------------|
| Mais de 1 dia restante    | `5d 12h restantes`          |
| Último dia (< 24h)        | `⚠️ 18h 30min restantes`   |
| Vencido                   | `🚨 SLA vencido`            |

### 5.3 Alertas e Notificações de SLA

Quando um lead entra em nível `critical`:

1. **Mensagem automática** postada no canal `group` em `mod_crm.messages` com `type = 'sla_alert'`, contendo: nome do lead, empresa, produto, etapa e tempo restante.
2. **Notificação push** exibida no sino (🔔) do HUB Central para:
   - O usuário com `assigned_to = lead.assigned_to` (vendedor responsável).
   - Todos os usuários com permissão `crm:dashboard:visualizar_equipe` (gerentes).
   - **Apenas esses dois grupos.** Outros vendedores não são alertados.
3. O popup do sino abre **automaticamente** para os usuários elegíveis.
4. Badge de não lida (🔴) aparece na aba **Conversas** da sidebar para os mesmos usuários.

### 5.4 Cadastro de Lead — Campos Obrigatórios e Validações

Campos obrigatórios no cadastro de lead:

| Campo              | Validação                                                                |
|--------------------|--------------------------------------------------------------------------|
| Nome e Sobrenome   | Não vazio                                                                |
| Empresa            | Não vazio                                                                |
| E-mail             | Regex `^[^\s@]+@[^\s@]+\.[^\s@]{2,}$`                                   |
| Telefone           | DDD (2 dígitos) + 8 dígitos (fixo) ou 9 dígitos (celular). Armazenado com `+55`. Display sem DDI |
| Fonte do lead      | Seleção obrigatória de `mod_crm.lists` (tipo: `source`)                  |
| Produto / Área     | Seleção obrigatória de `mod_crm.lists` (tipo: `product`)                 |
| Vendedor responsável | Obrigatório. Deve ser usuário com permissão `crm:leads:visualizar`. **Não pode ter perfil Marketing** |
| Etiquetas          | Mínimo 1 selecionada de `mod_crm.lists` (tipo: `tag`)                   |

**Formato de telefone:**
- Armazenado internamente: `+5511999990000`
- Exibido ao usuário: `(11) 99999-0000` (celular) ou `(11) 3333-0000` (fixo)
- O DDI `+55` não é exibido em campos de input. O usuário preenche apenas DDD + número.

### 5.5 Descarte de Leads

| Tipo              | Quem pode | Comportamento                                         |
|-------------------|-----------|-------------------------------------------------------|
| Suave (`soft`)    | Todos     | Marcado como `sem interesse`; pode ser reativado      |
| Definitivo (`hard`)| Requer permissão `crm:leads:descartar_definitivo` | Marcado como `fora de perfil`; aparece apenas em relatório de descartados |

### 5.6 Convite de Usuários

- Ao criar um novo usuário pelo painel de configurações do módulo, é gerada uma **senha temporária** (`invite123`).
- No primeiro acesso, o usuário é redirecionado para uma tela de **definição de nova senha** (mínimo 6 caracteres).
- Botão de reenvio de convite disponível para usuários com `passwordSet = false`.
- **Cooldown de reenvio:** mínimo **60 minutos** entre reenvios para o mesmo usuário.
- O envio real do e-mail de convite depende do backend SMTP configurado (ver Seção 7.1).

### 5.7 Alerta de Gerente via Lead

Gerentes e SuperAdministradores podem, a partir do painel de detalhes de um lead no pipeline:

1. Clicar em **"Enviar alerta ao vendedor"**.
2. Digitar uma mensagem contextualizada.
3. A mensagem é entregue como **mensagem direta (DM)** de `conversation_id = dm_{min_user_id}_{max_user_id}` para o vendedor responsável.
4. A mensagem inclui nome do lead, empresa e produto automaticamente.
5. **Registrado na timeline do lead** em `mod_crm.lead_timeline`.
6. **Notificação push** abre automaticamente o sino do destinatário.
7. O remetente **não recebe** notificação em seu próprio sino (ele é o emissor).

---

## 6. Módulo de Campanhas

### 6.1 Segmentação

- Campanhas são disparadas para leads que possuam **todas as etiquetas** selecionadas na campanha.
- Segmentação exclusivamente por etiquetas do array `leads.tags`.

### 6.2 Canais Suportados

| Canal      | Dependência                            |
|------------|----------------------------------------|
| `email`    | Canal Email configurado (SMTP/SES)     |
| `whatsapp` | Canal WhatsApp configurado             |
| `sms`      | Canal SMS configurado                  |

### 6.3 Corpo do E-mail

- Suporte a dois formatos independentes por campanha: **Texto puro** e **HTML**.
- Trocar entre formatos **não apaga o conteúdo** do outro formato (armazenados separadamente).
- Variáveis de personalização disponíveis:

| Variável           | Substituído por                  |
|--------------------|----------------------------------|
| `{{nome_lead}}`    | `leads.name`                     |
| `{{empresa_lead}}` | `leads.company`                  |
| `{{vendedor}}`     | Nome do usuário `assigned_to`    |
| `{{produto}}`      | `leads.product`                  |

- Pré-visualização HTML renderizada inline antes do disparo.

---

## 7. Configurações do Módulo (Painel SuperAdmin)

Todas as configurações sensíveis são acessíveis apenas por usuários com permissão `crm:config:*` e, no caso de canais e integrações, exclusivamente pelo **SuperAdministrador do HUB Central**.

Dados sensíveis (senhas, chaves de API, secrets) são **criptografados em repouso** antes de gravar em `mod_crm.channel_config` e `mod_crm.integration_config`.

### 7.1 Canal: E-mail (SMTP / Amazon SES)

| Campo              | Obrigatório | Descrição                           |
|--------------------|-------------|-------------------------------------|
| `from_name`        | Sim         | Nome exibido como remetente         |
| `from_email`       | Sim         | Endereço de envio                   |
| `smtp_host`        | Sim         | Host do servidor SMTP               |
| `smtp_port`        | Sim         | Porta (ex: 587, 465)                |
| `smtp_user`        | Sim         | Usuário de autenticação SMTP        |
| `smtp_pass`        | Sim         | Senha SMTP (criptografada)          |
| `smtp_security`    | Não         | `TLS`, `SSL` ou `Nenhuma`           |
| `ses_region`       | Não         | Região AWS (ex: `us-east-1`)        |
| `ses_access_key`   | Não         | Access Key da AWS                   |
| `ses_secret_key`   | Não         | Secret Key da AWS (criptografada)   |

**Backend necessário:** O módulo expõe um endpoint interno `/api/crm/email/send` que utiliza **Nodemailer** (SMTP) ou **@aws-sdk/client-ses** (SES). O frontend nunca acessa credenciais diretamente.

**Função de teste:** O painel exibe campo de e-mail de destino e botão "Verificar" que, após o deploy com backend, envia um e-mail de teste validando as credenciais configuradas.

### 7.2 Canal: 3CX Telefonia

| Campo         | Descrição                                 |
|---------------|-------------------------------------------|
| `server_url`  | URL do servidor 3CX                       |
| `api_key`     | Chave de API do 3CX (v20+)               |
| `extension`   | Ramal padrão para click-to-call           |

### 7.3 Canal: WhatsApp

| Campo            | Descrição                              |
|------------------|----------------------------------------|
| `api_endpoint`   | URL da API (ex: Evolution API)         |
| `instance_name`  | Nome da instância conectada            |
| `api_token`      | Token de autenticação                  |

### 7.4 Canal: SMS

| Campo         | Descrição                              |
|---------------|----------------------------------------|
| `provider`    | Provedor (ex: Clickatel, GoIP)         |
| `api_key`     | Chave de API do provedor               |
| `sender_id`   | Identificador do remetente SMS         |

### 7.5 Integração: API para Landing Pages

Endpoint de recebimento de leads capturados por formulários externos.

| Campo            | Descrição                                          |
|------------------|----------------------------------------------------|
| `endpoint_url`   | Gerado pelo sistema. Fixo. Apenas leitura          |
| `api_token`      | Token Bearer para autenticação das requisições     |
| `allowed_origin` | Domínio autorizado para CORS                       |

**Payload de entrada esperado (POST):**

```json
{
  "name": "string",
  "company": "string",
  "email": "string",
  "phone": "string",
  "source": "Landing Page",
  "product": "string",
  "tags": ["string"]
}
```

### 7.6 Integração: N8N / Agente IA

| Campo         | Descrição                                         |
|---------------|---------------------------------------------------|
| `webhook_url` | URL do webhook N8N que receberá eventos do CRM   |
| `auth_token`  | Token Bearer para autenticar chamadas do N8N      |
| `secret`      | Segredo para verificação de assinatura HMAC       |

### 7.7 Integração: Sincronização de Base de Usuários

| Campo       | Descrição                                             |
|-------------|-------------------------------------------------------|
| `api_url`   | URL da API externa de usuários                        |
| `api_key`   | Chave de API (criptografada)                          |
| `email_field`| Nome do campo de e-mail na API externa (padrão: `email`) |

### 7.8 Listas Configuráveis

Gerenciadas em `mod_crm.lists`. Cada tipo permite adicionar e desativar itens via interface. Tipos disponíveis:

| Tipo           | Exemplos                                         |
|----------------|--------------------------------------------------|
| `tag`          | Urgente, Premium, Corporativo, Recorrente        |
| `source`       | Landing Page, WhatsApp, Indicação, N8N, Manual   |
| `product`      | Fibra, PABX, Canais de Vendas, Cursos, Projetos  |
| `partner`      | Nenhum, [parceiros configurados]                 |
| `loss_reason`  | Preço, Concorrente, Sem budget, Sem interesse    |

### 7.9 SLA por Etapa

Configurável por etapa ativa. Campos:

| Campo    | Tipo   | Descrição                           |
|----------|--------|-------------------------------------|
| `value`  | INTEGER| Valor numérico                      |
| `unit`   | ENUM   | `minutes`, `hours`, `days`          |

---

## 8. Relatórios

| ID               | Título                    | Visibilidade                              | Exportável |
|------------------|---------------------------|-------------------------------------------|------------|
| `semanal`        | Atividades da Semana      | Gerente, SuperAdmin                       | Sim        |
| `descartados`    | Leads Descartados         | Gerente, SuperAdmin                       | Sim        |
| `motivos_perda`  | Motivos de Perda          | Todos (com permissão)                     | Sim        |
| `fechamentos`    | Fechamentos do Mês        | Gerente, SuperAdmin                       | Sim        |
| `performance`    | Performance por Vendedor  | Gerente, SuperAdmin                       | Sim        |
| `sla`            | Cumprimento de SLA        | Gerente, SuperAdmin                       | Sim        |

**Filtros disponíveis:** Período (`este mês`, `mês anterior`, `últimos 3 meses`, `personalizado`) e, no modo personalizado, campo de quantidade de meses retroativos.

---

## 9. Mensageria Interna (Conversas)

### 9.1 Tipos de Conversa

| `conversation_id`          | Descrição                                        |
|----------------------------|--------------------------------------------------|
| `group`                    | Canal "Equipe" — todos os usuários do módulo     |
| `dm_{min_uid}_{max_uid}`   | Mensagem direta entre dois usuários específicos  |

### 9.2 Regras

- Todos os usuários cadastrados no módulo aparecem automaticamente na lista de conversas.
- Ao atualizar a foto de perfil, ela é refletida em tempo real nas conversas.
- Cargo (perfil RBAC) do remetente é exibido ao lado do nome em cada mensagem.
- Mensagens de SLA automáticas (`type = 'sla_alert'`) são postadas no canal `group` pelo usuário `SYSTEM`.
- Alertas enviados por gerentes via painel de lead são entregues como DMs.

### 9.3 Badge de Não Lida

Badge vermelho (🔴) aparece na sidebar ao lado de "Conversas" quando:
- Chega alerta de SLA para um lead do qual o usuário é responsável ou é gerente.
- Chega DM endereçada ao usuário (qualquer remetente).

O badge desaparece ao entrar na aba Conversas. Dentro da aba, cada conversa com mensagem não lida exibe seu próprio indicador.

---

## 10. Eventos Emitidos pelo Módulo

Para o barramento de eventos do HUB Central (uso por outros módulos ou automações):

| Evento                    | Payload principal                                          |
|---------------------------|------------------------------------------------------------|
| `crm.lead.criado`         | `{ lead_id, name, company, product, assigned_to, source }` |
| `crm.lead.movido`         | `{ lead_id, from_column, to_column, user_id }`             |
| `crm.lead.ganho`          | `{ lead_id, value_activation, value_monthly, user_id }`    |
| `crm.lead.perdido`        | `{ lead_id, loss_reason, user_id }`                        |
| `crm.lead.sla_critico`    | `{ lead_id, column_id, sla_min_remaining, assigned_to }`   |
| `crm.campanha.disparada`  | `{ campaign_id, channel, lead_count }`                     |
| `crm.usuario.convidado`   | `{ user_id, email, role }`                                 |

---

## 11. APIs Expostas pelo Módulo

> Base path: `/api/crm/`  
> Autenticação: Bearer token via IAM do HUB Central em todas as rotas.

| Método | Rota                              | Permissão                     | Descrição                              |
|--------|-----------------------------------|-------------------------------|----------------------------------------|
| GET    | `/leads`                          | `crm:leads:visualizar`        | Listar leads (paginado, filtrado)      |
| POST   | `/leads`                          | `crm:leads:criar`             | Criar novo lead                        |
| PATCH  | `/leads/:id`                      | `crm:leads:editar`            | Atualizar dados do lead                |
| PATCH  | `/leads/:id/move`                 | `crm:pipeline:mover`          | Mover lead para outra etapa            |
| PATCH  | `/leads/:id/finalize`             | `crm:pipeline:finalizar`      | Finalizar lead (ganho/perdido)         |
| GET    | `/leads/:id/timeline`             | `crm:leads:visualizar`        | Histórico de ações do lead             |
| POST   | `/leads/:id/alert`                | `crm:pipeline:enviar_alerta`  | Gerente envia alerta ao vendedor       |
| GET    | `/campaigns`                      | `crm:campanhas:visualizar`    | Listar campanhas                       |
| POST   | `/campaigns`                      | `crm:campanhas:criar`         | Criar campanha                         |
| POST   | `/campaigns/:id/dispatch`         | `crm:campanhas:disparar`      | Disparar campanha                      |
| GET    | `/reports/:report_id`             | `crm:relatorios:[id]`         | Gerar relatório                        |
| GET    | `/messages`                       | `crm:conversas:visualizar`    | Listar mensagens de uma conversa       |
| POST   | `/messages`                       | `crm:conversas:enviar_mensagem`| Enviar mensagem                       |
| GET    | `/config/sla`                     | `crm:config:sla`              | Ler configurações de SLA               |
| PUT    | `/config/sla`                     | `crm:config:sla`              | Atualizar SLA de uma etapa             |
| GET    | `/config/lists`                   | `crm:config:listas`           | Listar itens configuráveis             |
| POST   | `/config/lists`                   | `crm:config:listas`           | Adicionar item a uma lista             |
| PUT    | `/config/channels/:channel_id`    | `crm:config:canais`           | Salvar config de canal (SuperAdmin)    |
| PUT    | `/config/integrations/:integ_id`  | `crm:config:integracoes`      | Salvar config de integração (SuperAdmin)|
| POST   | `/inbound/lead`                   | API Token (sem Bearer)        | Receber lead de Landing Page           |
| POST   | `/email/send`                     | Interno                       | Disparar e-mail via SMTP/SES           |

---

## 12. Requisitos de Infraestrutura

| Requisito            | Especificação                                               |
|----------------------|-------------------------------------------------------------|
| SGBD                 | PostgreSQL 15+, schema `mod_crm`                           |
| Backend              | Node.js 20+ com Express ou Fastify                         |
| E-mail               | Nodemailer (SMTP) ou `@aws-sdk/client-ses` (Amazon SES)    |
| Scheduler SLA        | Worker rodando a cada 30 segundos para recalcular deadlines |
| WebSocket            | Necessário para notificações e badge em tempo real          |
| Criptografia config  | AES-256 para campos sensíveis de `channel_config` e `integration_config` |
| Migrations           | Gerenciadas via Flyway ou ferramenta padrão do HUB Central  |

---

## 13. Changelog

| Versão  | Data       | Descrição                          |
|---------|------------|------------------------------------|
| `1.0.0` | 2026-06-18 | Especificação inicial do módulo CRM|

---

*Documento gerado a partir do protótipo Vibecode CRM e aderente à arquitetura HUB Central v1.*
