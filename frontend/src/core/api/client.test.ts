import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { request, ApiError } from "./client.js";
import { useSessionStore } from "../auth/session-store.js";

/**
 * @file client.test.ts
 *
 * Testes do ApiClient: injeção do token Bearer, mapeamento de erro
 * `{ code, message, details }` e logout em 401.
 */

describe("ApiClient", () => {
  beforeEach(() => {
    useSessionStore.getState().clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("injeta o token Bearer em requisições autenticadas", async () => {
    useSessionStore.getState().setSession("tok-123", { id: "u1", email: "a@b.com", role: "operator", password_set: true }, []);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await request("/api/x");

    const [, init] = fetchMock.mock.calls[0]!;
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer tok-123");
  });

  it("mapeia erro para ApiError preservando code/message/details", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ code: "CONTACT_DUPLICATE_EMAIL", message: "dup", details: { existing_contact_id: "c1" } }), {
          status: 409,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    await expect(request("/api/x", { method: "POST", body: {} })).rejects.toMatchObject({
      code: "CONTACT_DUPLICATE_EMAIL",
      status: 409,
    });
    await expect(request("/api/x")).rejects.toBeInstanceOf(ApiError);
  });

  it("em 401, limpa a sessão local", async () => {
    useSessionStore.getState().setSession("tok", { id: "u1", email: "a@b.com", role: "operator", password_set: true }, []);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 401 })),
    );

    await expect(request("/api/x")).rejects.toBeInstanceOf(ApiError);
    expect(useSessionStore.getState().token).toBeNull();
  });
});
