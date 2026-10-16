import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { downloadAttachment } from "./projetos.js";
import { useSessionStore } from "../auth/session-store.js";

/**
 * @file projetos.test.ts
 *
 * Testes do cliente de Projetos: o download de anexo precisa enviar o header
 * Authorization Bearer (a rota exige token; uma navegação por href sem token
 * falharia com 401).
 */

describe("downloadAttachment", () => {
  beforeEach(() => {
    useSessionStore.getState().clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("envia o header Authorization Bearer ao baixar o anexo", async () => {
    useSessionStore.getState().setSession("tok-123", { id: "u1", email: "a@b.com", role: "operator", password_set: true }, []);

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(new Blob(["conteudo"]), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    // Object URL e âncora: stubar para não depender do jsdom.
    vi.stubGlobal("URL", { ...URL, createObjectURL: vi.fn(() => "blob:fake"), revokeObjectURL: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    await downloadAttachment({ id: "att-1", original_name: "arquivo.png", mime_type: "image/png" });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/projetos/attachments/att-1");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer tok-123");
  });
});
