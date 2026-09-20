# Requirements Document

## Introduction

Este documento especifica a **Base Central de Contatos** e o **Contrato de Módulos** do HUB Central — o par de recursos que fecha a lacuna mais crítica entre o núcleo (core) e os módulos satélites (ex.: `mod_crm`).

Hoje o Módulo CRM define sua própria tabela `mod_crm.leads` com campos de contato (nome, empresa, e-mail, telefone) que duplicam dados que deveriam viver em um único ponto de verdade. A seção §7 da arquitetura central determina que uma **tabela central de contatos** seja o ponto-chave da qualidade de dados: deve categorizar contatos (lead frio, cliente ativo/inativo, fornecedor ativo/inativo ou categorias de livre criação), relacionar empresas a pessoas (uma empresa → muitas pessoas), permitir campos personalizados e ser referenciada pelos módulos **sem duplicação** de dados.

Este documento captura dois grupos de requisitos entrelaçados:

1. **Base Central de Contatos** (`core.contacts` e tabelas relacionadas): fonte única de verdade para contatos (pessoas e empresas), relacionamento empresa↔pessoa, categorização, campos personalizados, deduplicação e filtros de segmentação consumidos pelos módulos.
2. **Contrato de Módulos**: o contrato formal que todo módulo satélite deve cumprir para se registrar no núcleo e para **referenciar** contatos centrais sem copiá-los — como um lead do CRM aponta para um contato central em vez de duplicá-lo, o manifesto de registro do módulo, os namespaces RBAC declarados, os eventos emitidos e os endpoints de importação/exportação condicionados a permissões explícitas.

## Glossary

- **HUB_Central**: plataforma-núcleo (monólito modular com Arquitetura Orientada a Eventos) que centraliza IAM, auditoria, contatos e o barramento de eventos.
- **Base_Central_Contatos**: conjunto de tabelas no schema `core` (a começar por `core.contacts`) que é a fonte única de verdade de contatos.
- **Contato**: registro na Base_Central_Contatos que representa uma pessoa física ou uma empresa (pessoa jurídica).
- **Contato_Pessoa**: contato cujo tipo é pessoa física.
- **Contato_Empresa**: contato cujo tipo é empresa (pessoa jurídica).
- **Vinculo_Empresa_Pessoa**: relação entre um Contato_Empresa e um ou mais Contato_Pessoa.
- **Categoria_Contato**: classificação do contato (lead frio, cliente ativo, cliente inativo, fornecedor ativo, fornecedor inativo, ou categoria de livre criação).
- **Categoria_Customizada**: Categoria_Contato criada pelo usuário além das categorias de sistema.
- **Campo_Personalizado**: campo de dados definido pelo usuário e anexado a contatos (ex.: escola dos filhos, hobby preferido, perfume preferido).
- **Segmento**: conjunto de critérios de filtro sobre contatos, categorias, vínculos e campos personalizados, utilizado por módulos para seleção em massa (ex.: campanhas).
- **Modulo_Satelite**: subsistema acoplado ao HUB_Central que reside em um schema `mod_[nome]` (ex.: `mod_crm`).
- **Contrato_Modulo**: conjunto de regras que um Modulo_Satelite deve cumprir para se registrar e operar no HUB_Central.
- **Manifesto_Modulo**: documento JSON que o Modulo_Satelite declara ao se registrar (module_id, schema, versão, flags de exportação/importação/eventos, tabelas de núcleo requeridas).
- **Referencia_Contato**: ponteiro (`contact_id` UUID) que um registro de um Modulo_Satelite mantém para um Contato, em substituição à cópia dos dados do contato.
- **Registro_IAM**: tabela `core.users`, fonte única de identidade e autenticação.
- **RBAC_Namespace**: permissão no formato `[modulo]:[recurso]:[acao]`.
- **Log_Auditoria**: registro imutável gravado em `core.system_logs`.
- **Barramento_Eventos**: mecanismo de publicação/assinatura de eventos do HUB_Central.
- **Administrador_Modulo**: usuário com atribuição de gestão operacional de um módulo.
- **SuperAdministrador**: usuário com acesso global ao HUB_Central.

## Requirements

### Requirement 1: Cadastro de contatos como fonte única de verdade

**User Story:** Como Administrador_Modulo, quero cadastrar contatos em uma base central única, para que os dados de contato não sejam duplicados entre módulos.

#### Acceptance Criteria

1. THE Base_Central_Contatos SHALL armazenar cada Contato no schema `core` como registro único identificado por um `contact_id` do tipo UUID.
2. WHEN um Contato é criado, THE Base_Central_Contatos SHALL registrar o tipo do Contato como `pessoa` ou `empresa`.
3. THE Base_Central_Contatos SHALL armazenar, para um Contato_Pessoa, nome, e-mail e telefone.
4. THE Base_Central_Contatos SHALL armazenar, para um Contato_Empresa, razão social e documento de identificação fiscal.
5. WHEN um e-mail é informado para um Contato, THE Base_Central_Contatos SHALL validar o e-mail contra o padrão `^[^\s@]+@[^\s@]+\.[^\s@]{2,}$`.
6. IF um campo obrigatório do Contato está ausente na criação, THEN THE Base_Central_Contatos SHALL rejeitar a criação e retornar uma mensagem que identifica o campo ausente.
7. WHEN um Contato é criado ou alterado, THE HUB_Central SHALL gravar um Log_Auditoria em `core.system_logs` com `module = 'core'` contendo `payload_before` e `payload_after`.

### Requirement 2: Relacionamento entre empresas e pessoas

**User Story:** Como Administrador_Modulo, quero vincular pessoas a empresas, para que uma empresa possa ter várias pessoas associadas sem repetir cadastros.

#### Acceptance Criteria

1. THE Base_Central_Contatos SHALL permitir associar um ou mais Contato_Pessoa a um Contato_Empresa por meio de um Vinculo_Empresa_Pessoa.
2. WHEN um Vinculo_Empresa_Pessoa é criado, THE Base_Central_Contatos SHALL armazenar o `contact_id` do Contato_Empresa e o `contact_id` do Contato_Pessoa.
3. WHERE um Vinculo_Empresa_Pessoa registra o papel da pessoa na empresa, THE Base_Central_Contatos SHALL armazenar o papel informado.
4. IF for solicitada a criação de um Vinculo_Empresa_Pessoa em que o lado empresa não é um Contato_Empresa, THEN THE Base_Central_Contatos SHALL rejeitar a criação e retornar uma mensagem de erro descritiva.
5. IF for solicitada a criação de um Vinculo_Empresa_Pessoa que duplica um vínculo já existente entre o mesmo par, THEN THE Base_Central_Contatos SHALL rejeitar a criação e retornar uma mensagem de erro descritiva.
6. WHEN um Contato_Pessoa vinculado é consultado, THE Base_Central_Contatos SHALL retornar os Contato_Empresa aos quais a pessoa está vinculada.

### Requirement 3: Categorização de contatos

**User Story:** Como Administrador_Modulo, quero classificar cada contato por categoria, para que a base indique se o contato é lead frio, cliente, fornecedor ou outra categoria.

#### Acceptance Criteria

1. THE Base_Central_Contatos SHALL disponibilizar as categorias de sistema `lead_frio`, `cliente_ativo`, `cliente_inativo`, `fornecedor_ativo` e `fornecedor_inativo`.
2. THE Base_Central_Contatos SHALL permitir associar um Contato a uma ou mais Categoria_Contato.
3. WHERE um Administrador_Modulo cria uma Categoria_Customizada, THE Base_Central_Contatos SHALL armazenar a Categoria_Customizada e disponibilizá-la para associação a Contatos.
4. WHEN a Categoria_Contato de um Contato é alterada, THE HUB_Central SHALL gravar um Log_Auditoria em `core.system_logs` contendo a categoria anterior e a nova.
5. IF for solicitada a criação de uma Categoria_Customizada com nome idêntico ao de uma categoria existente, THEN THE Base_Central_Contatos SHALL rejeitar a criação e retornar uma mensagem de erro descritiva.
6. THE Base_Central_Contatos SHALL permitir consultar Contatos filtrando por uma ou mais Categoria_Contato.

### Requirement 4: Campos personalizados

**User Story:** Como Administrador_Modulo, quero definir campos personalizados nos contatos, para que informações futuras (como escola dos filhos, hobby ou perfume preferido) possam ser armazenadas sem alterar o esquema do banco.

#### Acceptance Criteria

1. WHERE um Administrador_Modulo define um Campo_Personalizado, THE Base_Central_Contatos SHALL armazenar o nome do campo e o tipo de dado do campo.
2. THE Base_Central_Contatos SHALL permitir associar valores de Campo_Personalizado a um Contato.
3. WHEN um valor de Campo_Personalizado é informado para um Contato, THE Base_Central_Contatos SHALL validar o valor contra o tipo de dado definido para o Campo_Personalizado.
4. IF o valor informado para um Campo_Personalizado não corresponde ao tipo de dado definido, THEN THE Base_Central_Contatos SHALL rejeitar o valor e retornar uma mensagem de erro descritiva.
5. THE Base_Central_Contatos SHALL permitir consultar Contatos filtrando por valores de Campo_Personalizado.

### Requirement 5: Deduplicação de contatos

**User Story:** Como Administrador_Modulo, quero que a base evite contatos duplicados, para que a qualidade dos dados de cadastro seja preservada.

#### Acceptance Criteria

1. WHEN um Contato_Pessoa é criado, THE Base_Central_Contatos SHALL verificar a existência de um Contato_Pessoa com o mesmo e-mail.
2. IF um Contato_Pessoa com o mesmo e-mail já existe na criação, THEN THE Base_Central_Contatos SHALL rejeitar a criação e retornar o `contact_id` do Contato existente na mensagem de erro.
3. WHEN um Contato_Empresa é criado, THE Base_Central_Contatos SHALL verificar a existência de um Contato_Empresa com o mesmo documento de identificação fiscal.
4. IF um Contato_Empresa com o mesmo documento de identificação fiscal já existe na criação, THEN THE Base_Central_Contatos SHALL rejeitar a criação e retornar o `contact_id` do Contato existente na mensagem de erro.
5. WHEN um Administrador_Modulo solicita a mesclagem de dois Contatos do mesmo tipo, THE Base_Central_Contatos SHALL transferir os Vinculo_Empresa_Pessoa, as Categoria_Contato, os valores de Campo_Personalizado e as Referencia_Contato do Contato de origem para o Contato de destino.
6. WHEN uma mesclagem de Contatos é concluída, THE HUB_Central SHALL gravar um Log_Auditoria em `core.system_logs` identificando o Contato de origem e o Contato de destino.

### Requirement 6: Segmentação de contatos para uso pelos módulos

**User Story:** Como usuário de marketing, quero segmentar contatos por critérios, para que campanhas de envio em massa alcancem apenas o público adequado sem duplicar dados.

#### Acceptance Criteria

1. THE Base_Central_Contatos SHALL permitir definir um Segmento a partir de critérios de Categoria_Contato, Vinculo_Empresa_Pessoa e valores de Campo_Personalizado.
2. WHEN um Segmento é avaliado, THE Base_Central_Contatos SHALL retornar os `contact_id` dos Contatos que satisfazem todos os critérios do Segmento.
3. THE Base_Central_Contatos SHALL disponibilizar aos Modulo_Satelite uma interface de consulta de Segmento que retorna apenas Referencia_Contato.
4. WHERE um Segmento é persistido para reutilização, THE Base_Central_Contatos SHALL armazenar os critérios do Segmento e o `user_id` que o criou.
5. IF um Segmento não define nenhum critério, THEN THE Base_Central_Contatos SHALL rejeitar a avaliação do Segmento e retornar uma mensagem de erro descritiva.

### Requirement 7: Referência de contatos pelos módulos sem duplicação

**User Story:** Como desenvolvedor de módulo, quero que meu módulo referencie contatos centrais em vez de copiá-los, para que os dados de contato tenham uma única fonte de verdade.

#### Acceptance Criteria

1. WHEN um Modulo_Satelite associa um registro a um Contato, THE Modulo_Satelite SHALL armazenar apenas uma Referencia_Contato (`contact_id` UUID) para o Contato.
2. THE Contrato_Modulo SHALL proibir que um Modulo_Satelite armazene nome, e-mail, telefone ou documento fiscal de um Contato em suas tabelas `mod_[nome]`.
3. WHEN um Modulo_Satelite necessita de dados de um Contato, THE Modulo_Satelite SHALL obter os dados por consulta à Base_Central_Contatos usando a Referencia_Contato.
4. IF um Modulo_Satelite armazena uma Referencia_Contato para um `contact_id` inexistente, THEN THE HUB_Central SHALL rejeitar a operação e retornar uma mensagem de erro descritiva.
5. WHERE um Contato referenciado por um Modulo_Satelite é solicitado para exclusão, THE Base_Central_Contatos SHALL impedir a exclusão enquanto existir ao menos uma Referencia_Contato ativa e retornar a lista de módulos que referenciam o Contato.

### Requirement 8: Registro de módulo via manifesto

**User Story:** Como desenvolvedor de módulo, quero registrar meu módulo por um manifesto declarativo, para que o HUB_Central conheça suas capacidades e dependências.

#### Acceptance Criteria

1. WHEN um Modulo_Satelite se registra, THE Modulo_Satelite SHALL fornecer um Manifesto_Modulo contendo `module_id`, `display_name`, `schema`, `version`, `config_panel`, `has_export`, `has_import`, `emits_events` e `requires_core_tables`.
2. IF um Manifesto_Modulo omite um campo obrigatório, THEN THE HUB_Central SHALL rejeitar o registro e retornar uma mensagem que identifica o campo ausente.
3. IF o `module_id` de um Manifesto_Modulo já está registrado, THEN THE HUB_Central SHALL rejeitar o registro e retornar uma mensagem de erro descritiva.
4. IF o `schema` declarado no Manifesto_Modulo não segue o padrão `mod_[nome]`, THEN THE HUB_Central SHALL rejeitar o registro e retornar uma mensagem de erro descritiva.
5. WHEN um Manifesto_Modulo declara `requires_core_tables`, THE HUB_Central SHALL verificar a existência de cada tabela de núcleo declarada antes de concluir o registro.
6. IF uma tabela de núcleo declarada em `requires_core_tables` não existe, THEN THE HUB_Central SHALL rejeitar o registro e retornar a tabela ausente na mensagem de erro.
7. WHEN um Modulo_Satelite conclui o registro, THE HUB_Central SHALL gravar um Log_Auditoria em `core.system_logs` identificando o `module_id` e a `version` registrados.
8. THE version do Manifesto_Modulo SHALL seguir o formato de versionamento semântico `MAJOR.MINOR.PATCH`.

### Requirement 9: Identidade e autenticação delegadas ao núcleo

**User Story:** Como SuperAdministrador, quero que todos os módulos usem o IAM central, para que não existam bases de usuários paralelas.

#### Acceptance Criteria

1. THE Contrato_Modulo SHALL proibir que um Modulo_Satelite mantenha tabela própria de usuários.
2. WHEN um Modulo_Satelite referencia um usuário, THE Modulo_Satelite SHALL usar o `user_id` (UUID) do Registro_IAM.
3. WHEN uma requisição chega a uma rota de um Modulo_Satelite, THE HUB_Central SHALL autenticar a requisição pelo IAM centralizado.
4. IF uma requisição a uma rota de um Modulo_Satelite não apresenta autenticação válida do IAM centralizado, THEN THE HUB_Central SHALL rejeitar a requisição e retornar um erro de não autorizado.

### Requirement 10: Declaração e verificação de namespaces RBAC

**User Story:** Como SuperAdministrador, quero que os módulos declarem seus namespaces de permissão, para que eu conceda acessos granulares pelo painel IAM.

#### Acceptance Criteria

1. WHEN um Modulo_Satelite se registra, THE Modulo_Satelite SHALL declarar seus RBAC_Namespace no formato `[modulo]:[recurso]:[acao]`.
2. IF um RBAC_Namespace declarado não segue o formato `[modulo]:[recurso]:[acao]`, THEN THE HUB_Central SHALL rejeitar o registro e retornar o namespace inválido na mensagem de erro.
3. WHEN um usuário aciona uma ação de um Modulo_Satelite, THE HUB_Central SHALL verificar se o usuário possui o RBAC_Namespace correspondente à ação.
4. IF o usuário não possui o RBAC_Namespace correspondente à ação, THEN THE HUB_Central SHALL negar a ação e retornar um erro de acesso negado.
5. THE HUB_Central SHALL atribuir RBAC_Namespace a usuários somente por meio do Administrador_Modulo ou do SuperAdministrador.

### Requirement 11: Importação e exportação condicionadas a permissões explícitas

**User Story:** Como SuperAdministrador, quero que importação e exportação de dados dependam de permissões explícitas, para que a movimentação de dados seja controlada e auditada.

#### Acceptance Criteria

1. WHERE um Manifesto_Modulo declara `has_export = true`, THE Modulo_Satelite SHALL expor um endpoint de exportação nos formatos CSV, JSON e XLSX.
2. WHERE um Manifesto_Modulo declara `has_import = true`, THE Modulo_Satelite SHALL expor um endpoint de importação que aceite os formatos CSV, JSON e XLSX.
3. WHEN uma exportação é solicitada, THE HUB_Central SHALL verificar se o usuário possui o RBAC_Namespace `[modulo]:[recurso]:exportar`.
4. WHEN uma importação é solicitada, THE HUB_Central SHALL verificar se o usuário possui o RBAC_Namespace `[modulo]:[recurso]:importar`.
5. IF o usuário não possui o RBAC_Namespace de exportação ou de importação exigido, THEN THE HUB_Central SHALL negar a operação e retornar um erro de acesso negado.
6. WHEN uma importação é executada, THE Modulo_Satelite SHALL validar os dados antes de persistir e retornar as linhas rejeitadas com o motivo da rejeição.
7. WHEN uma exportação ou importação é concluída, THE HUB_Central SHALL gravar um Log_Auditoria em `core.system_logs` identificando o usuário, o módulo e o volume de registros processados.

### Requirement 12: Emissão de eventos para o barramento

**User Story:** Como desenvolvedor de módulo, quero emitir eventos para o barramento central, para que outros módulos e automações reajam a mudanças sem acoplamento direto.

#### Acceptance Criteria

1. WHERE um Manifesto_Modulo declara `emits_events = true`, THE Modulo_Satelite SHALL publicar seus eventos no Barramento_Eventos.
2. WHEN um Modulo_Satelite publica um evento, THE Modulo_Satelite SHALL nomear o evento no formato `[modulo].[recurso].[acao]`.
3. WHEN um evento envolve um Contato, THE Modulo_Satelite SHALL incluir a Referencia_Contato (`contact_id`) no payload do evento em vez dos dados do Contato.
4. WHEN um Contato referenciado por Modulo_Satelite tem seus dados alterados na Base_Central_Contatos, THE HUB_Central SHALL publicar um evento `core.contato.atualizado` contendo o `contact_id` no Barramento_Eventos.

### Requirement 13: Auditoria centralizada dos módulos

**User Story:** Como SuperAdministrador, quero que todos os módulos gravem auditoria no log central, para que exista um registro imutável e unificado das ações.

#### Acceptance Criteria

1. WHEN um Modulo_Satelite executa uma ação auditável, THE Modulo_Satelite SHALL gravar um Log_Auditoria em `core.system_logs` com o campo `module` preenchido com o nome do módulo.
2. THE Contrato_Modulo SHALL proibir que um Modulo_Satelite grave logs de auditoria em tabelas próprias.
3. WHEN um Log_Auditoria é gravado, THE HUB_Central SHALL incluir `id`, `timestamp` em UTC, `user_id`, `module`, `action`, `payload_before`, `payload_after`, `ip_address` e `user_agent`.
4. THE HUB_Central SHALL impedir a alteração de um Log_Auditoria após a sua gravação.

### Requirement 14: Migração do CRM para a base central de contatos

**User Story:** Como Administrador_Modulo do CRM, quero que os leads referenciem contatos centrais, para que os dados de contato do CRM deixem de ser duplicados.

#### Acceptance Criteria

1. THE Modulo_Satelite `mod_crm` SHALL substituir os campos de contato `name`, `company`, `email` e `phone` da tabela `mod_crm.leads` por uma Referencia_Contato para um Contato_Pessoa e uma Referencia_Contato para um Contato_Empresa.
2. WHEN um lead é criado no `mod_crm` com dados de contato de um Contato inexistente, THE HUB_Central SHALL criar o Contato correspondente na Base_Central_Contatos e associar a Referencia_Contato ao lead.
3. WHEN um lead é criado no `mod_crm` com dados de contato de um Contato existente, THE HUB_Central SHALL associar a Referencia_Contato do Contato existente ao lead sem criar um novo Contato.
4. WHEN uma campanha do `mod_crm` é segmentada, THE Modulo_Satelite `mod_crm` SHALL obter o público-alvo por avaliação de um Segmento da Base_Central_Contatos.
5. WHEN dados de contato de um lead são exibidos no `mod_crm`, THE Modulo_Satelite `mod_crm` SHALL obter esses dados da Base_Central_Contatos usando a Referencia_Contato.
