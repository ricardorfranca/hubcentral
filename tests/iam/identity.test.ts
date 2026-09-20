import { describe, it, expect, afterAll } from "vitest";
import fc from "fast-check";
import type { PoolClient } from "pg";
import { withRollback, closeTestPool } from "../helpers/db.js";
import { hashPassword, verifyPassword, isValidPassword } from "../../src/core/iam/password.js";
import {
  inviteUser,
  resendInvite,
  setPassword,
  authenticate,
  TEMP_PASSWORD,
  RESEND_COOLDOWN_MS,
} from "../../src/core/iam/identity-service.js";
import {
  createSession,
  validateSession,
  revokeSession,
} from "../../src/core/iam/session-service.js";
import { DomainError, ErrorCode } from "../../src/core/errors.js";

/**
 * @file identity.test.ts
 *
 * Testes do IAM: hashing de senha, provisionamento/convite, primeiro acesso,
 * cooldown de reenvio, autenticação e sessões.
 */

const RUNS = { numRuns: 50 } as const;

afterAll(async () => {
  await closeTestPool();
});

let seq = 0;
async function invite(client: PoolClient): Promise<{ id: string; email: string }> {
  seq += 1;
  const email = `iam${seq}-${Math.random().toString(36).slice(2)}@example.com`;
  const u = await inviteUser(client, { email, full_name: `User ${seq}`, role: "operator" });
  return { id: u.id, email };
}

describe("Senha (scrypt)", () => {
  it("round-trip: verifyPassword aceita a senha correta e rejeita a errada", async () => {
    await fc.assert(
      fc.property(
        fc.string({ minLength: 6, maxLength: 40 }),
        fc.string({ minLength: 6, maxLength: 40 }),
        (pwd, other) => {
          fc.pre(pwd !== other);
          const hash = hashPassword(pwd);
          expect(verifyPassword(pwd, hash)).toBe(true);
          expect(verifyPassword(other, hash)).toBe(false);
        },
      ),
      RUNS,
    );
  });

  it("hashes do mesmo texto diferem (salt aleatório) mas ambos verificam", () => {
    const h1 = hashPassword("senha123");
    const h2 = hashPassword("senha123");
    expect(h1).not.toBe(h2);
    expect(verifyPassword("senha123", h1)).toBe(true);
    expect(verifyPassword("senha123", h2)).toBe(true);
  });

  it("política mínima: rejeita senhas curtas", () => {
    expect(isValidPassword("12345")).toBe(false);
    expect(isValidPassword("123456")).toBe(true);
  });
});

describe("Provisionamento e autenticação", () => {
  it("convite cria usuário com senha temporária e password_set=false", async () => {
    await withRollback(async (client) => {
      const { id, email } = await invite(client);
      const user = await authenticate(client, email, TEMP_PASSWORD);
      expect(user.id).toBe(id);
      expect(user.password_set).toBe(false);
    });
  });

  it("e-mail duplicado é rejeitado", async () => {
    await withRollback(async (client) => {
      const { email } = await invite(client);
      try {
        await inviteUser(client, { email, full_name: "Dup", role: "operator" });
        expect.unreachable("deveria rejeitar e-mail duplicado");
      } catch (err) {
        expect((err as DomainError).code).toBe(ErrorCode.IAM_EMAIL_TAKEN);
      }
    });
  });

  it("credenciais inválidas são rejeitadas", async () => {
    await withRollback(async (client) => {
      const { email } = await invite(client);
      try {
        await authenticate(client, email, "senha-errada");
        expect.unreachable("deveria rejeitar senha errada");
      } catch (err) {
        expect((err as DomainError).code).toBe(ErrorCode.IAM_INVALID_CREDENTIALS);
      }
    });
  });

  it("primeiro acesso: setPassword marca password_set e permite login com a nova senha", async () => {
    await withRollback(async (client) => {
      const { id, email } = await invite(client);
      await setPassword(client, id, "novaSenha1");
      const user = await authenticate(client, email, "novaSenha1");
      expect(user.password_set).toBe(true);
    });
  });

  it("setPassword rejeita senha fraca", async () => {
    await withRollback(async (client) => {
      const { id } = await invite(client);
      try {
        await setPassword(client, id, "123");
        expect.unreachable("deveria rejeitar senha fraca");
      } catch (err) {
        expect((err as DomainError).code).toBe(ErrorCode.IAM_WEAK_PASSWORD);
      }
    });
  });
});

describe("Cooldown de reenvio de convite (60 min)", () => {
  it("rejeita reenvio dentro do cooldown e permite depois", async () => {
    await withRollback(async (client) => {
      const { id } = await invite(client);
      const base = new Date();

      // Logo após o convite: dentro do cooldown -> rejeita.
      try {
        await resendInvite(client, id, new Date(base.getTime() + 60 * 1000));
        expect.unreachable("deveria rejeitar reenvio dentro do cooldown");
      } catch (err) {
        expect((err as DomainError).code).toBe(ErrorCode.IAM_RESEND_COOLDOWN);
      }

      // Após 60 min + 1s: permite.
      await resendInvite(client, id, new Date(base.getTime() + RESEND_COOLDOWN_MS + 1000));
    });
  });
});

describe("Sessões", () => {
  it("sessão válida resolve o user_id; expirada e revogada falham", async () => {
    await withRollback(async (client) => {
      const { id } = await invite(client);
      const now = new Date();
      const { token } = await createSession(client, id, 60_000, now);

      // Válida.
      expect(await validateSession(client, token, now)).toBe(id);

      // Expirada.
      try {
        await validateSession(client, token, new Date(now.getTime() + 61_000));
        expect.unreachable("deveria falhar sessão expirada");
      } catch (err) {
        expect((err as DomainError).code).toBe(ErrorCode.IAM_INVALID_SESSION);
      }

      // Revogada.
      expect(await revokeSession(client, token)).toBe(true);
      try {
        await validateSession(client, token, now);
        expect.unreachable("deveria falhar sessão revogada");
      } catch (err) {
        expect((err as DomainError).code).toBe(ErrorCode.IAM_INVALID_SESSION);
      }
    });
  });

  it("token inexistente é rejeitado", async () => {
    await withRollback(async (client) => {
      try {
        await validateSession(client, "token-que-nao-existe");
        expect.unreachable("deveria falhar token inexistente");
      } catch (err) {
        expect((err as DomainError).code).toBe(ErrorCode.IAM_INVALID_SESSION);
      }
    });
  });
});
