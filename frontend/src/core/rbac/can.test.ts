import { describe, it, expect } from "vitest";
import { hasPermission, isSuperadmin } from "./can.js";
import type { AuthUser, UserRole } from "../api/types.js";

/**
 * @file can.test.ts
 *
 * Testes da verificação de permissão RBAC no cliente.
 */

/** Monta um `AuthUser` mínimo com o papel informado (fixture local). */
function userWithRole(role: UserRole): AuthUser {
  return { id: "u1", email: "u1@example.com", role, password_set: true };
}

describe("hasPermission", () => {
  it("concede quando nenhum namespace é exigido", () => {
    expect(hasPermission([], undefined)).toBe(true);
  });

  it("concede sse o namespace está presente", () => {
    expect(hasPermission(["crm:pipeline:mover"], "crm:pipeline:mover")).toBe(true);
    expect(hasPermission(["crm:pipeline:visualizar"], "crm:pipeline:mover")).toBe(false);
  });
});

describe("isSuperadmin", () => {
  it("retorna true para o papel superadmin", () => {
    expect(isSuperadmin(userWithRole("superadmin"))).toBe(true);
  });

  it("retorna false para os demais papéis", () => {
    expect(isSuperadmin(userWithRole("module_admin"))).toBe(false);
    expect(isSuperadmin(userWithRole("operator"))).toBe(false);
    expect(isSuperadmin(userWithRole("client"))).toBe(false);
  });

  it("retorna false quando não há usuário na sessão", () => {
    expect(isSuperadmin(undefined)).toBe(false);
    expect(isSuperadmin(null)).toBe(false);
  });
});
