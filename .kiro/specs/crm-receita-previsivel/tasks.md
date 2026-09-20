# Implementation Plan — CRM 2.0 (Receita Previsível)

Plano incremental em fases; cada fase é um incremento funcional verificável (typecheck + testes + build) e uma release.

## Fase 1 — Contas, Contatos e Oportunidades com valores

- [ ] 1.1 Migrations: `mod_crm.accounts`, `mod_crm.account_contacts`, `mod_crm.stages` (+ seed pipeline padrão), `mod_crm.opportunities`, `mod_crm.opportunity_contacts`. _Req 1,2,3_
- [ ] 1.2 account-service (createAccount find-or-create empresa por CNPJ + registerReference; linkContact; getAccount; listAccounts) + testes. _Req 1_
- [ ] 1.3 opportunity-service (createOpportunity exige conta+valores; getOpportunity; listOpportunities com filtros) + testes (ARR=MRR×12, múltiplas por conta). _Req 2,8_
- [ ] 1.4 Migração de dados `mod_crm.leads` → contas + oportunidades; teste de migração. _Req (transição)_
- [ ] 1.5 Rotas HTTP `/api/crm/accounts` e `/api/crm/opportunities` (CRUD/listagem) + namespaces RBAC novos. _Req 1,2,8_
- [ ] 1.6 Verificar fase 1 (backend) e release.

## Fase 2 — Pipeline configurável + probabilidade + forecast

- [ ] 2.1 stage-service (CRUD estágios, probabilidade) + rotas. _Req 3_
- [ ] 2.2 opportunity moveStage/finalize (probabilidade herdada, timeline, auditoria, eventos) + testes. _Req 2,3_
- [ ] 2.3 forecast-service (weightedForecast, newMrrArr, conversionByStage, por origem/dono) + testes PBT do forecast. _Req 5_
- [ ] 2.4 Rotas de dashboards/forecast. _Req 5_
- [ ] 2.5 Verificar e release.

## Fase 3 — Atividades + correção da mensageria

- [ ] 3.1 Migration `mod_crm.activities` + activity-service (create/complete/listMy/byOpportunity) + rotas + testes. _Req 4_
- [ ] 3.2 message-service: listConversations(userId) (group+DMs, não lidas), markRead; rotas + testes. _Req 7_

## Fase 4 — Frontend: contas, oportunidades, atividades, dashboards, conversas

- [ ] 4.1 API tipada + hooks (accounts, opportunities, stages, activities, forecast, conversations).
- [ ] 4.2 Telas Contas (lista+detalhe) e Oportunidades (Kanban+lista+detalhe com valores/atividades/timeline). _Req 1,2,8_
- [ ] 4.3 Tela Atividades (agenda) e Conversas corrigida. _Req 4,7_
- [ ] 4.4 Dashboards de Receita Previsível (forecast, MRR/ARR, conversão). _Req 5_
- [ ] 4.5 Registrar no módulo frontend (menus + namespaces); remover telas antigas de "leads".

## Fase 5 — Histórico/nutrição e polimento

- [ ] 5.1 Detalhe do contato/conta com histórico de oportunidades, atividades e campanhas; labels via categorias/campos. _Req 6_
- [ ] 5.2 Formulários completos (todos os campos), validações, filtros; revisão de UX.
- [ ] 5.3 Atualizar README/ModuloCRM.md/CHANGELOG; release consolidada (v0.6.0+).
