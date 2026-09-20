import "@testing-library/jest-dom/vitest";

/**
 * Garante um localStorage funcional no ambiente de teste (jsdom nem sempre
 * fornece uma implementação completa, exigida pelo middleware persist do Zustand).
 */
if (typeof globalThis.localStorage === "undefined" || typeof globalThis.localStorage.setItem !== "function") {
  const store = new Map<string, string>();
  const mock: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    removeItem: (k: string) => void store.delete(k),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
  };
  Object.defineProperty(globalThis, "localStorage", { value: mock, configurable: true });
}
