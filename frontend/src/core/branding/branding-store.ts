/**
 * @file branding-store.ts
 * @module core/branding
 *
 * Estado do branding white-label (Zustand). Guarda nome do sistema, logotipo,
 * cores e o modo de visualização (claro/escuro), aplicáveis ao tema em tempo de
 * execução (§4.3 da arquitetura). O modo de cor é persistido por usuário no
 * localStorage; nome/logo/cores refletem a configuração do sistema.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";

/** Modo de cor da interface. */
export type ColorMode = "light" | "dark";

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
  primaryColor: "#e53935",
  secondaryColor: "#b71c1c",
};

/** Estado e ações do branding. */
interface BrandingState extends Branding {
  /** Modo de cor atual (claro/escuro). */
  mode: ColorMode;
  /** Aplica um branding parcial sobre o atual. */
  setBranding: (branding: Partial<Branding>) => void;
  /** Define o modo de cor. */
  setMode: (mode: ColorMode) => void;
  /** Alterna entre claro e escuro. */
  toggleMode: () => void;
}

/**
 * Store do branding. Apenas o `mode` é persistido (preferência do usuário); as
 * demais chaves são hidratadas da configuração do sistema no login/boot.
 */
export const useBrandingStore = create<BrandingState>()(
  persist(
    (set) => ({
      ...DEFAULT_BRANDING,
      mode: "light",
      setBranding: (branding) => set((state) => ({ ...state, ...branding })),
      setMode: (mode) => set({ mode }),
      toggleMode: () => set((state) => ({ mode: state.mode === "light" ? "dark" : "light" })),
    }),
    {
      name: "hubcentral.branding",
      // Persiste somente a preferência de modo de cor.
      partialize: (state) => ({ mode: state.mode }),
    },
  ),
);
