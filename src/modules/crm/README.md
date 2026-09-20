# Módulo CRM (`mod_crm`)

Subsistema nativo do HUB Central para gestão do ciclo de vida de leads e oportunidades comerciais. Adere ao contrato do núcleo: referencia contatos por `contact_id`, delega identidade ao IAM, grava auditoria em `core.system_logs` e emite eventos no barramento central.

## Serviços

| Arquivo | Responsabilidade |
|---------|------------------|
| `lead-service.ts` | Leads: criação (find-or-create de contatos), movimentação no pipeline, finalização, visão com dados de contato resolvidos |
| `sla-service.ts` | SLA por etapa, cálculo com **memória entre etapas**, níveis de urgência |
| `timeline-service.ts` | Histórico imutável de ações do lead |
| `message-service.ts` | Mensageria interna: canal de equipe e DMs, alertas de SLA e de gerente |
| `campaign-service.ts` | Campanhas segmentadas por etiquetas, corpo text/html, disparo |
| `list-service.ts` | Listas configuráveis (etiquetas, origens, produtos, parceiros, motivos) |
| `report-service.ts` | Relatórios: fechamentos, motivos de perda, performance, SLA |

## Regras de destaque

- **Referência sem duplicação**: `mod_crm.leads` guarda `person_contact_id`/`company_contact_id`, nunca nome/e-mail/telefone.
- **SLA com memória** (§5.2.3): ao sair de uma etapa o prazo é memorizado; ao retornar, é restaurado (não reinicia).
- **Eventos**: `crm.lead.criado`, `crm.lead.movido`, `crm.lead.ganho`, `crm.lead.perdido`, `crm.campanha.disparada` — todos carregam apenas referências de contato.

## Tabelas

`mod_crm.leads`, `mod_crm.lists`, `mod_crm.sla_config`, `mod_crm.lead_timeline`, `mod_crm.messages`, `mod_crm.campaigns`.

Especificação de origem: `ModuloCRM.md` (raiz do repositório).
