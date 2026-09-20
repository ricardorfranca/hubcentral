/**
 * @file branding-store.ts
 * @module core/branding
 *
 * Estado do branding white-label (Zustand). Guarda nome do sistema, logotipo e
 * cores, aplicáveis ao tema em tempo de execução (§4.3 da arquitetura).
 */

import { create } from "zustand";

/** Configuração visual white-label. */
export interface Branding {
  systemName: string;
  logoUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
}

/** Branding padrão do HUB Central (fallback quando não há customização). */
export const DEFAULT_BRANDING: Branding = {
  systemName: "HUB Central",
  logoUrl: null,
  primaryColor: "#1565c0",
  secondaryColor: "#00897b",
};

/** Estado e ações do branding. */
interface BrandingState extends Branding {
  /** Aplica um branding parcial sobre o atual. */
  setBranding: (branding: Partial<Branding>) => void;
}

/** Store do branding. */
export const useBrandingStore = create<BrandingState>()((set) => ({
  ...DEFAULT_BRANDING,
  setBranding: (branding) => set((state) => ({ ...state, ...branding })),
}));
