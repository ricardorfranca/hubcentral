import { describe, it, expect } from "vitest";
import { hasPermission } from "./can.js";

/**
 * @file can.test.ts
 *
 * Testes da verificação de permissão RBAC no cliente.
 */

describe("hasPermission", () => {
  it("concede quando nenhum namespace é exigido", () => {
    expect(hasPermission([], undefined)).toBe(true);
  });

  it("concede sse o namespace está presente", () => {
    expect(hasPermission(["crm:pipeline:mover"], "crm:pipeline:mover")).toBe(true);
    expect(hasPermission(["crm:pipeline:visualizar"], "crm:pipeline:mover")).toBe(false);
  });
});
