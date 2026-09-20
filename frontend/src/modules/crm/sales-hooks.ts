/**
 * @file sales-hooks.ts
 * @module modules/crm
 *
 * Hooks TanStack Query do CRM 2.0 (Receita Previsível): contas, oportunidades,
 * estágios, atividades, forecast e conversas, com invalidação de cache.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  listAccounts, getAccount, createAccount, linkContact,
  listOpportunities, getOpportunity, createOpportunity, moveStage, finalizeOpportunity,
  listStages, getForecast,
  listMyActivities, listOpportunityActivities, createActivity, completeActivity,
  listConversations, markConversationRead,
  type OpportunityFilters,
} from "../../core/api/crm-sales.js";

/** Chaves de query do CRM 2.0. */
const keys = {
  accounts: ["crm2", "accounts"] as const,
  account: (id: string) => ["crm2", "account", id] as const,
  opportunities: (f: OpportunityFilters) => ["crm2", "opportunities", f] as const,
  opportunity: (id: string) => ["crm2", "opportunity", id] as const,
  oppActivities: (id: string) => ["crm2", "opp-activities", id] as const,
  stages: ["crm2", "stages"] as const,
  forecast: ["crm2", "forecast"] as const,
  myActivities: ["crm2", "my-activities"] as const,
  conversations: ["crm2", "conversations"] as const,
};

// --- Contas ---

/** Lista de contas. */
export function useAccounts() {
  return useQuery({ queryKey: keys.accounts, queryFn: listAccounts });
}

/** Detalhe de uma conta. */
export function useAccount(id: string) {
  return useQuery({ queryKey: keys.account(id), queryFn: () => getAccount(id), enabled: Boolean(id) });
}

/** Criação de conta; invalida a lista. */
export function useCreateAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createAccount,
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.accounts }),
  });
}

/** Vínculo de contato a uma conta; invalida o detalhe. */
export function useLinkContact(accountId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ personContactId, role }: { personContactId: string; role?: string }) =>
      linkContact(accountId, personContactId, role),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.account(accountId) }),
  });
}

// --- Oportunidades ---

/** Lista de oportunidades filtrada. */
export function useOpportunities(filters: OpportunityFilters = {}) {
  return useQuery({ queryKey: keys.opportunities(filters), queryFn: () => listOpportunities(filters) });
}

/** Detalhe de uma oportunidade. */
export function useOpportunity(id: string) {
  return useQuery({ queryKey: keys.opportunity(id), queryFn: () => getOpportunity(id), enabled: Boolean(id) });
}

/** Criação de oportunidade; invalida listas. */
export function useCreateOpportunity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createOpportunity,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["crm2", "opportunities"] }),
  });
}

/** Movimento de estágio; invalida listas e o detalhe. */
export function useMoveStage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, stageId }: { id: string; stageId: string }) => moveStage(id, stageId),
    onSuccess: (opp) => {
      qc.invalidateQueries({ queryKey: ["crm2", "opportunities"] });
      qc.invalidateQueries({ queryKey: keys.opportunity(opp.id) });
    },
  });
}

/** Finalização (ganho/perdido); invalida listas, detalhe e forecast. */
export function useFinalizeOpportunity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, outcome, extra }: {
      id: string;
      outcome: "won" | "lost";
      extra?: { mrr?: number; one_time?: number; loss_reason?: string };
    }) => finalizeOpportunity(id, outcome, extra),
    onSuccess: (opp) => {
      qc.invalidateQueries({ queryKey: ["crm2", "opportunities"] });
      qc.invalidateQueries({ queryKey: keys.opportunity(opp.id) });
      qc.invalidateQueries({ queryKey: keys.forecast });
    },
  });
}

// --- Estágios ---

/** Lista de estágios do pipeline. */
export function useStages() {
  return useQuery({ queryKey: keys.stages, queryFn: listStages });
}

// --- Forecast ---

/** Agregados de Receita Previsível. */
export function useForecast() {
  return useQuery({ queryKey: keys.forecast, queryFn: getForecast });
}

// --- Atividades ---

/** Atividades do usuário autenticado. */
export function useMyActivities() {
  return useQuery({ queryKey: keys.myActivities, queryFn: listMyActivities });
}

/** Atividades de uma oportunidade. */
export function useOpportunityActivities(opportunityId: string) {
  return useQuery({
    queryKey: keys.oppActivities(opportunityId),
    queryFn: () => listOpportunityActivities(opportunityId),
    enabled: Boolean(opportunityId),
  });
}

/** Criação de atividade; invalida agenda e atividades da oportunidade. */
export function useCreateActivity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createActivity,
    onSuccess: (act) => {
      qc.invalidateQueries({ queryKey: keys.myActivities });
      if (act.opportunity_id) {
        qc.invalidateQueries({ queryKey: keys.oppActivities(act.opportunity_id) });
      }
    },
  });
}

/** Conclusão de atividade; invalida agenda e atividades da oportunidade. */
export function useCompleteActivity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => completeActivity(id),
    onSuccess: (act) => {
      qc.invalidateQueries({ queryKey: keys.myActivities });
      if (act.opportunity_id) {
        qc.invalidateQueries({ queryKey: keys.oppActivities(act.opportunity_id) });
      }
    },
  });
}

// --- Conversas ---

/** Lista de conversas com não lidas. */
export function useConversations() {
  return useQuery({ queryKey: keys.conversations, queryFn: listConversations, refetchInterval: 15_000 });
}

/** Marcar conversa como lida; invalida a lista de conversas. */
export function useMarkConversationRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (conversationId: string) => markConversationRead(conversationId),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.conversations }),
  });
}
