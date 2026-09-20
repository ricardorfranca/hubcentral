\# Architecture Specification: HUB Central

&nbsp;

\#\# 1\. Visão Geral do Sistema

\* \*\*Nome do Projeto:\*\* HUB Central

\* \*\*Objetivo:\*\* Plataforma parametrizável de centralização, orquestração e integração de serviços satélites, conectando ERPs, CRMs, bancos, APIs externas e módulos nativos.

\* \*\*Motivação:\*\* Funcionar como um conector universal e barramento de serviços, eliminando o acoplamento direto entre sistemas e oferecendo um portal operacional unificado para a empresa e para os clientes finais.

\* \*\*Modelo Arquitetural:\*\* Monólito Modular Extensível com Arquitetura Orientada a Eventos (EDA).

&nbsp;

\---

&nbsp;

\#\# 2\. Autenticação, Autorização e Identidade (IAM Centralizado)

&nbsp;

\#\#\# 2.1 Tabela Única de Usuários (\`core.users\`)

Todos os usuários (SuperAdmin, Administradores de Módulo, Operadores e Usuários Clientes) residem na tabela central do núcleo. Os dados específicos e relacionamentos operacionais de cada módulo são vinculados ao \`user\_id\` em suas respectivas tabelas locais.

&nbsp;

\#\#\# 2.2 Níveis de Acesso

1\. \*\*SuperAdministrador:\*\* Acesso global, gestão de infraestrutura, expurgo/rotação de logs, parametrização de backups, customização visual e provisionamento de usuários.

2\. \*\*Administrador de Módulo:\*\* Gestão operacional dos módulos atribuídos e criação de Operadores/Clientes dentro de seu escopo.

3\. \*\*Operador (Usuário Interno):\*\* Execução operacional de acordo com suas permissões contextuais.

4\. \*\*Usuário Cliente:\*\* Acesso restrito à Central do Cliente (visualização unificada de dados consolidados de múltiplos sistemas e módulos de acordo com sua parametrização).

&nbsp;

\#\#\# 2.3 Matriz de Permissões Granulares (RBAC)

\* Acesso controlado por sintaxe de namespaces: \`\[modulo\]:\[submodulo\_ou\_recurso\]:\[acao\]\`.

\* \*\*Exportação e Importação de Dados:\*\* Todo módulo que armazena dados internos deve disponibilizar endpoints/interfaces de Importação (CSV/JSON/XLSX) e Exportação. Estas ações \*\*obrigatoriamente dependem de permissões explícitas\*\* (ex: \`financeiro:faturas:exportar\` e \`financeiro:faturas:importar\`).

&nbsp;

\---

&nbsp;

\#\# 3\. Módulos, Integrações Externas e Editor de Scripts (Cron Engine)

&nbsp;

\#\#\# 3.1 Contrato e Área de Configurações do Módulo

Cada módulo acoplado ao HUB Central deve disponibilizar uma \*\*Painel de Configurações Próprio\*\* contendo:

\* Mapeamento de Credenciais/Chaves de API para sistemas externos.

\* Escolha do método de comunicação (REST, Webhook, gRPC, Banco a Banco).

\* Parametrização de regras de negócio locais.

\* Validador antes de efetivas a integração ou importação evitando erros irreparáveis.

&nbsp;

\#\#\# 3.2 Editor de Integrações e Agendador (Cron Engine)

\* \*\*Persistência de Scripts:\*\* Os scripts customizados (Python, Node.js ou SQL) criados via interface administrativa são armazenados na tabela \`core.automation\_scripts\` com histórico de versões.

\* \*\*Modo de Execução e Disparos:\*\* Execução acionada por agendamentos temporais (expressões Cron), Webhooks ou disparo manual.

\* \*\*Mecanismos de Proteção contra Travamentos (Sandbox & Isolation):\*\*

&nbsp;&nbsp;\* \*\*Processos Isolados:\*\* Scripts rodam em instâncias/threads filhas separadas do processo principal da aplicação.

&nbsp;&nbsp;\* \*\*Execution Timeout:\*\* Limite máximo de tempo de execução por script (ex: 30 segundos); atingido o limite, o processo é encerrado compulsoriamente.

&nbsp;&nbsp;\* \*\*Memory Limit:\*\* Limite teto de consumo de RAM alocado para o script.

&nbsp;&nbsp;\* \*\*Catch de Exceções:\*\* Erros em scripts são isolados, gravados nos logs de erro do sistema e não afetam a disponibilidade da interface do HUB Central.

&nbsp;

\---

&nbsp;

\#\# 4\. Administração Global (SuperAdmin Control Panel)

&nbsp;

\#\#\# 4.1 Retenção, Rotação e Expurgo de Logs

\* \*\*Modo Automático:\*\* Definição de janela de retenção (ex: "Excluir automaticamente logs com mais de X dias").

\* \*\*Modo Manual:\*\* Botão de execução sob demanda com filtros por intervalo de datas e módulo.

\* \*\*Auditoria de Expurgo:\*\* Toda ação de expurgo gera um registro imutável no log de infraestrutura informando o responsável e o volume de registros excluídos.

&nbsp;

\#\#\# 4.2 Gestão de Backups e Armazenamento

\* \*\*Escopo Selecionável:\*\* O SuperAdmin pode configurar rotinas ou executar backups de:

&nbsp;&nbsp;1\. Apenas o Banco de Dados (Dump PostgreSQL).

&nbsp;&nbsp;2\. Apenas Arquivos e Anexos Locais (Uploads dos módulos).

&nbsp;&nbsp;3\. Backup Completo (Banco \+ Arquivos).

\* \*\*Periodicidade e Disparo:\*\* Suporte a backups agendados (Diário, Semanal, Mensal) ou acionamento imediato ("Fazer Backup Agora").

\* \*\*Destinos Suportados:\*\*

&nbsp;&nbsp;\* \*\*Diretório Local / Mount Disk:\*\* Cópia para pastas locais ou volumes montados no servidor.

&nbsp;&nbsp;\* \*\*Servidor SFTP/FTP:\*\* Transferência segura para servidores remotos de armazenamento.

&nbsp;

\#\#\# 4.3 Customização Visual e Branding (White Label)

A interface baseada no \*\*Google Material Design\*\* permite alteração em tempo de execução via painel SuperAdmin:

\* Logotipo (Marca d'água, Tela de Login, Favicon e Header).

\* Paleta de Cores Dinâmica (Primary, Secondary, Accent, Backgrounds).

\* Configurações aplicadas globalmente via variáveis CSS / Theme Provider.

&nbsp;

\---

&nbsp;

\#\# 5\. Estratégia de Banco de Dados (PostgreSQL)

&nbsp;

\* \*\*SGBD:\*\* PostgreSQL (v15+)

\* \*\*Estrutura de Schemas:\*\*

&nbsp;&nbsp;\* \`core\`: Usuários, IAM, Autenticações, Configurações Globais, Automações Cron, Backups e Tabela Central de Auditoria.

&nbsp;&nbsp;\* \`mod\_\[nome\_do\_modulo\]\`: Isolamento estrito de dados por subsistema.

\* \*\*Logs de Auditoria Imutáveis (\`core.system\_logs\`):\*\*

&nbsp;&nbsp;\* \`id\` (UUID)

&nbsp;&nbsp;\* \`timestamp\` (UTC)

&nbsp;&nbsp;\* \`user\_id\` (FK \`core.users\` ou \`SYSTEM\`)

&nbsp;&nbsp;\* \`module\` (Ex: "financeiro", "core")

&nbsp;&nbsp;\* \`action\` (Ex: "FATURA\_CRIADA", "BACKUP\_EXECUTADO")

&nbsp;&nbsp;\* \`payload\_before\` (JSONB \- Estado anterior)

&nbsp;&nbsp;\* \`payload\_after\` (JSONB \- Estado novo)

&nbsp;&nbsp;\* \`ip\_address\` / \`user\_agent\`

&nbsp;

\---

&nbsp;

\#\# 6\. Diretrizes de Desenvolvimento, Qualidade e DevOps

&nbsp;

\#\#\# 6.1 Versionamento de Código e Deploy (GitHub Workflow)

\* \*\*Repositório Central:\*\* Todo o código-fonte deve estar sob controle de versão no GitHub.

\* \*\*Releases e Tagging (SemVer):\*\* A cada ajuste, correção de bug ou novo módulo adicionado, é \*\*obrigatória\*\* a criação de uma \*\*Release/Tag\*\* no GitHub (ex: \`v1.2.0\`) contendo o \*Changelog\* detalhado das alterações.

&nbsp;

\#\#\# 6.2 Documentação Obrigatória (\`README.md\`)

\* O arquivo \`README.md\` da raiz do projeto e os arquivos \`README.md\` individuais dentro de cada módulo \*\*devem ser atualizados a cada modificação estrutural ou novo recurso\*\*.

\* Instruções claras de setup, migrations do PostgreSQL necessárias, dependências e variáveis de ambiente (\`.env\`).

&nbsp;

\#\#\# 6.3 Padrão de Código e Comentários

\* \*\*Documentação In-Code:\*\* 100% do código deve ser comentado no padrão JSDoc/Docstrings, detalhando a responsabilidade de funções, parâmetros e retornos para facilitar a manutenção por qualquer desenvolvedor humano.

\* \*\*Tratamento de Exceções:\*\* Falhas em integrações externas não podem derrubar o HUB Central; devem ser capturadas, registradas no log de auditoria e notificadas.

&nbsp;

&nbsp;

\#\# 7\. Diretrizes de qualidade de dados de cadastro

&nbsp;

\#\#\# 7.1 Uma tabela de cadastro central de contatos será ponto chave para a qualidade das informações. Esta tabela apontará se o contato se refere a lead frio, cliente ativo ou inativo, fornecedor ativo ou inativo ou ainda se está em alguma outra categoria de livre criação;

&nbsp;

\#\#\# 7.2 Esta base de cadastro deve ter as relações entre empresas e pessoas, ou seja, cada empresa poderá ter mais que uma pessoa vinculada a ela.

&nbsp;

\#\#\# 7.3 Deve ter ainda filtros e relacionamentos para que se tenha o devido relacionamento de dados com os referidos módulos sem duplicidade de dados no banco de dados, mas sim, relacionamento entre eles, como por exemplo um módulo de CRM, ou ainda campanhas relacionadas com filtros específicos para envio em massa de maneira adequada conforme filtros.

&nbsp;

\#\#\# 7.4 Preferencialmente deve ter possibilidade de ter campos personalizados para inserir informações que possam ser adequadas para o futuro, como por exemplo: qual escola os filhos estudam, ou ainda, qual seu hobby preferido, ou ainda, qual seu perfume preferido, etc.