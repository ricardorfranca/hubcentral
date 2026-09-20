/**
 * @file pipeline.ts
 * @module modules/crm
 *
 * Definição das etapas do pipeline do CRM (§5.1 do ModuloCRM). Etapas ativas
 * exibidas como colunas do Kanban; as terminais são exibidas separadamente.
 */

/** Uma etapa do pipeline. */
export interface PipelineStage {
  id: string;
  label: string;
  terminal: boolean;
}

/** Etapas do pipeline em ordem. */
export const PIPELINE_STAGES: PipelineStage[] = [
  { id: "novo", label: "Novo Lead", terminal: false },
  { id: "ligacao", label: "Ligação Inicial", terminal: false },
  { id: "proposta", label: "Proposta Preliminar", terminal: false },
  { id: "reuniao", label: "Reunião de Fechamento", terminal: false },
  { id: "acompanhamento", label: "Acompanhamento", terminal: false },
  { id: "ganho", label: "Concluído — Ganho", terminal: true },
  { id: "perdido", label: "Concluído — Perdido", terminal: true },
];

/** Colunas ativas (não terminais) do Kanban. */
export const ACTIVE_STAGES = PIPELINE_STAGES.filter((s) => !s.terminal);
