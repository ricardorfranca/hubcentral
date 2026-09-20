# Requirements Document — CRM 2.0 (Receita Previsível)

## Introduction

Esta especificação evolui o módulo CRM do HUB Central de um Kanban básico de "leads" para um **CRM B2B orientado a Receita Previsível** (Predictable Revenue, Aaron Ross). O princípio central alinha-se ao núcleo: o **contato é permanente** (fonte única de verdade em `core.contacts`) e acumula histórico de relacionamento e nutrição por anos; a **oportunidade de venda é efêmera e repetível** — um mesmo contato/conta pode originar várias oportunidades ao longo do tempo.

Hierarquia B2B modelada explicitamente: **Conta** (empresa com CNPJ) → **Contatos** vinculados → **Oportunidades** (com valor recorrente MRR e valor único, probabilidade por estágio e previsão ponderada) → **Atividades**. A origem segue o método (inbound, outbound/cold, indicação/seeds) e as métricas de receita previsível (pipeline ponderado, forecast, conversão por estágio, MRR/ARR) são de primeira classe.

## Glossary

- **Conta**: empresa no CRM, referenciando um `core.contacts` do tipo empresa (CNPJ). Em `mod_crm.accounts`.
- **Contato_CRM**: pessoa vinculada a uma Conta (N:N), referenciando `core.contacts` (pessoa).
- **Oportunidade**: ciclo de venda de uma Conta, com valores, estágio e probabilidade. Em `mod_crm.opportunities`.
- **Estagio**: fase configurável do pipeline, com probabilidade (%).
- **MRR/ARR**: receita recorrente mensal / anual (MRR×12) de uma Oportunidade.
- **Valor_Unico**: receita não recorrente (setup/implantação).
- **Forecast_Ponderado**: soma de (valor × probabilidade) das Oportunidades abertas.
- **Origem**: `inbound`, `outbound`, `indicacao`.
- **Qualificacao**: maturação (`frio`, `morno`, `quente`).
- **Atividade**: interação/tarefa (ligação, e-mail, reunião, nota) ligada a Conta/Contato/Oportunidade.
- **Base_Central_Contatos**: `core.contacts` e tabelas do núcleo (fonte de verdade).

## Requirements

### Requirement 1: Contas (empresas B2B)

**User Story:** Como vendedor, quero cadastrar e gerir contas corporativas, para organizar oportunidades por empresa.

#### Acceptance Criteria

1. WHEN uma Conta é criada, THE Modulo_CRM SHALL referenciar um `core.contacts` do tipo empresa (find-or-create por CNPJ), sem copiar razão social/CNPJ para `mod_crm`.
2. THE Modulo_CRM SHALL exigir CNPJ ao criar a Conta e validar o formato (14 dígitos).
3. THE Modulo_CRM SHALL permitir associar um ou mais Contato_CRM a uma Conta, cada um com um papel (ex.: decisor, influenciador, técnico).
4. THE Modulo_CRM SHALL armazenar dados comerciais da Conta (segmento, porte, dono da conta) sem duplicar dados de contato.
5. WHEN uma Conta é consultada, THE Modulo_CRM SHALL retornar seus contatos e oportunidades relacionadas.
6. WHEN uma Conta é criada ou alterada, THE HUB_Central SHALL gravar auditoria em `core.system_logs` com `module = 'crm'`.

### Requirement 2: Oportunidades com receita recorrente e única

**User Story:** Como vendedor, quero registrar oportunidades com valor recorrente e único, para prever receita.

#### Acceptance Criteria

1. THE Oportunidade SHALL pertencer a exatamente uma Conta.
2. THE Oportunidade SHALL armazenar valor recorrente mensal (MRR) e valor único (setup), ambos ≥ 0.
3. THE Modulo_CRM SHALL calcular ARR como MRR × 12 para exibição e relatórios.
4. THE Oportunidade SHALL registrar Origem (`inbound`/`outbound`/`indicacao`) e Qualificacao.
5. THE Oportunidade SHALL ter um dono (closer) referenciado por `user_id` do IAM.
6. WHEN uma Oportunidade é finalizada como ganha, THE Modulo_CRM SHALL exigir MRR e/ou Valor_Unico informados.
7. WHEN uma Oportunidade é finalizada como perdida, THE Modulo_CRM SHALL exigir um motivo de perda.
8. THE Modulo_CRM SHALL permitir que uma mesma Conta tenha múltiplas Oportunidades ao longo do tempo (histórico repetível).

### Requirement 3: Pipeline configurável com probabilidade

**User Story:** Como gerente, quero configurar os estágios do funil com probabilidades, para calcular forecast ponderado.

#### Acceptance Criteria

1. THE Modulo_CRM SHALL permitir configurar Estagios ordenados, cada um com probabilidade (0–100%).
2. WHEN uma Oportunidade entra em um Estagio, THE Modulo_CRM SHALL associar a probabilidade do Estagio à Oportunidade.
3. THE Modulo_CRM SHALL fornecer um pipeline padrão (Novo, Qualificação, Descoberta, Proposta, Negociação, Ganho, Perdido) com probabilidades sensatas.
4. WHEN uma Oportunidade é movida entre Estagios, THE Modulo_CRM SHALL registrar a transição na timeline e em auditoria.
5. THE Estagios terminais (Ganho=100%, Perdido=0%) SHALL encerrar a Oportunidade.

### Requirement 4: Atividades e cadência

**User Story:** Como vendedor, quero registrar atividades (ligações, e-mails, reuniões, tarefas), para conduzir a cadência de vendas.

#### Acceptance Criteria

1. THE Atividade SHALL ser vinculável a uma Conta, um Contato_CRM e/ou uma Oportunidade.
2. THE Atividade SHALL ter tipo (`ligacao`, `email`, `reuniao`, `tarefa`, `nota`), responsável (`user_id`), data e status (`pendente`/`concluida`).
3. WHEN uma Atividade é concluída, THE Modulo_CRM SHALL registrar na timeline da Oportunidade/Conta relacionada.
4. THE Modulo_CRM SHALL listar as Atividades pendentes de um usuário ordenadas por data.

### Requirement 5: Métricas de Receita Previsível

**User Story:** Como gerente, quero indicadores de receita previsível, para gerir o funil e o forecast.

#### Acceptance Criteria

1. THE Modulo_CRM SHALL calcular o Forecast_Ponderado como Σ((MRR×12 + Valor_Unico) × probabilidade) das Oportunidades abertas.
2. THE Modulo_CRM SHALL calcular MRR novo e ARR do período (Oportunidades ganhas).
3. THE Modulo_CRM SHALL calcular a taxa de conversão por Estagio.
4. THE Modulo_CRM SHALL segmentar os indicadores por Origem e por dono (closer).
5. THE Modulo_CRM SHALL expor os indicadores por período (mês atual, anterior, personalizado).

### Requirement 6: Histórico de relacionamento e nutrição

**User Story:** Como usuário de marketing, quero que o contato mantenha histórico e labels ao longo dos anos, para nutrir e segmentar campanhas.

#### Acceptance Criteria

1. THE Modulo_CRM SHALL preservar o Contato/Conta na Base_Central_Contatos independentemente do encerramento de Oportunidades.
2. THE Modulo_CRM SHALL permitir aplicar Labels (categorias/campos do núcleo) a contatos, acumuladas no tempo.
3. WHEN uma campanha é segmentada, THE Modulo_CRM SHALL usar as Labels via Segmentos do núcleo (retornando apenas `contact_id`).
4. THE Modulo_CRM SHALL exibir, no detalhe do contato/conta, o histórico de oportunidades, atividades e campanhas.

### Requirement 7: Correção e completude da mensageria

**User Story:** Como vendedor, quero conversar com a equipe e receber alertas sem erros, para colaborar no fechamento.

#### Acceptance Criteria

1. THE Modulo_CRM SHALL listar as conversas do usuário (canal da equipe e DMs em que participa).
2. THE Modulo_CRM SHALL permitir enviar mensagem no canal da equipe e em DMs.
3. WHEN um alerta de gerente é enviado a partir de uma Oportunidade, THE Modulo_CRM SHALL entregá-lo como DM ao dono e registrar na timeline.
4. THE Modulo_CRM SHALL indicar mensagens não lidas por conversa.

### Requirement 8: Visualizações de oportunidades

**User Story:** Como vendedor, quero ver as oportunidades em Kanban e em lista, para trabalhar do jeito que preferir.

#### Acceptance Criteria

1. THE Modulo_CRM SHALL exibir as Oportunidades em Kanban por Estagio.
2. THE Modulo_CRM SHALL exibir as Oportunidades em lista/tabela com filtros (conta, dono, origem, estágio, valor).
3. THE Modulo_CRM SHALL exibir, em cada card/linha, o nome da Conta, MRR, valor único e probabilidade.
4. WHERE o usuário não possui permissão de mover, THE Modulo_CRM SHALL desabilitar o arrastar-e-soltar.
