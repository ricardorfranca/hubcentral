/**
 * @file hooks.ts
 * @module modules/crm
 *
 * Hooks TanStack Query do CRM: leitura de leads/detalhe/timeline e mutations
 * (criar, mover) com invalidação do cache.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  listLeads, getLead, getLeadTimeline, createLead, moveLead,
  type CreateLeadPayload,
} from "../../core/api/crm.js";

/** Chaves de query do CRM. */
const keys = {
  leads: ["crm", "leads"] as const,
  lead: (id: string) => ["crm", "lead", id] as const,
  timeline: (id: string) => ["crm", "timeline", id] as const,
};

/** Lista de leads. */
export function useLeads() {
  return useQuery({ queryKey: keys.leads, queryFn: listLeads });
}

/** Detalhe de um lead. */
export function useLead(id: string) {
  return useQuery({ queryKey: keys.lead(id), queryFn: () => getLead(id), enabled: Boolean(id) });
}

/** Timeline de um lead. */
export function useLeadTimeline(id: string) {
  return useQuery({ queryKey: keys.timeline(id), queryFn: () => getLeadTimeline(id), enabled: Boolean(id) });
}

/** Criação de lead; invalida a lista. */
export function useCreateLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateLeadPayload) => createLead(payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.leads }),
  });
}

/** Movimento de lead entre etapas; invalida a lista. */
export function useMoveLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, toColumn }: { id: string; toColumn: string }) => moveLead(id, toColumn),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.leads }),
  });
}
