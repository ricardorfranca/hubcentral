import { describe, it, expect, afterAll } from "vitest";
import { withRollback, closeTestPool } from "../helpers/db.js";
import { hashPassword } from "../../src/core/iam/password.js";
import { grantNamespace } from "../../src/core/iam/rbac.js";
import { ALL_NAMESPACES } from "../../src/core/iam/namespaces.js";
import { authenticate } from "../../src/core/iam/identity-service.js";

/**
 * @file create-admin.test.ts
 *
 * Testa a lógica de bootstrap do SuperAdministrador (upsert + concessão de
 * todos os namespaces). Reproduz a transação do CLI usando o client de teste
 * (o CLI abre seu próprio pool; aqui validamos o comportamento SQL/serviços).
 */

afterAll(async () => {
  await closeTestPool();
});

describe("Bootstrap do SuperAdministrador", () => {
  it("cria superadmin com senha definida e concede todos os namespaces (idempotente)", async () => {
    await withRollback(async (client) => {
      const email = `admin-${Math.random().toString(36).slice(2)}@hubcentral.local`;
      const hash = hashPassword("adminpass1");

      // Executa o upsert duas vezes (idempotência).
      for (let i = 0; i < 2; i++) {
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO core.users (email, full_name, role, status, password_hash, password_set)
           VALUES ($1, 'Super Administrador', 'superadmin', 'active', $2, true)
           ON CONFLICT (email) DO UPDATE
             SET role = 'superadmin', status = 'active',
                 password_hash = EXCLUDED.password_hash, password_set = true
           RETURNING id`,
          [email, hash],
        );
        const userId = rows[0]!.id;
        for (const ns of ALL_NAMESPACES) {
          await grantNamespace(client, userId, ns);
        }
      }

      // Um único usuário, papel superadmin, autentica com a senha.
      const count = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM core.users WHERE email = $1`,
        [email],
      );
      expect(count.rows[0]?.count).toBe("1");

      const user = await authenticate(client, email, "adminpass1");
      expect(user.role).toBe("superadmin");
      expect(user.password_set).toBe(true);

      // Todos os namespaces concedidos (sem duplicar).
      const perms = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM core.user_permissions
         WHERE user_id = (SELECT id FROM core.users WHERE email = $1)`,
        [email],
      );
      expect(Number(perms.rows[0]?.count)).toBe(ALL_NAMESPACES.length);
    });
  });
});
