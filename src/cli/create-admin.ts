/**
 * @file create-admin.ts
 * @module cli
 *
 * Bootstrap de um SuperAdministrador. Idempotente: cria o usuário se não
 * existir (ou promove/atualiza um existente), define a senha e concede todos os
 * namespaces RBAC conhecidos. Usado pelo instalador na primeira implantação.
 *
 * Uso:
 *   node dist/cli/create-admin.js <email> <senha> [nome]
 * ou via ambiente:
 *   HUBCENTRAL_ADMIN_EMAIL=... HUBCENTRAL_ADMIN_PASSWORD=... node dist/cli/create-admin.js
 */

import { createPool, withTransaction } from "../core/db/pool.js";
import { hashPassword, isValidPassword } from "../core/iam/password.js";
import { grantNamespace } from "../core/iam/rbac.js";
import { ALL_NAMESPACES } from "../core/iam/namespaces.js";

/**
 * Cria ou atualiza um SuperAdministrador e concede todos os namespaces.
 *
 * @param email - E-mail do administrador.
 * @param password - Senha (mínimo 6 caracteres; já definida, sem primeiro acesso).
 * @param fullName - Nome exibido.
 * @returns O `user_id` do administrador.
 */
export async function createAdmin(email: string, password: string, fullName: string): Promise<string> {
  if (!isValidPassword(password)) {
    throw new Error("A senha do administrador deve ter ao menos 6 caracteres.");
  }
  const pool = createPool();
  try {
    return await withTransaction(pool, async (client) => {
      const hash = hashPassword(password);
      // Upsert por e-mail: cria como superadmin com senha já definida, ou
      // promove/atualiza um usuário existente.
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO core.users (email, full_name, role, status, password_hash, password_set)
         VALUES ($1, $2, 'superadmin', 'active', $3, true)
         ON CONFLICT (email) DO UPDATE
           SET role = 'superadmin', status = 'active',
               password_hash = EXCLUDED.password_hash, password_set = true,
               full_name = EXCLUDED.full_name
         RETURNING id`,
        [email, fullName, hash],
      );
      const userId = rows[0]!.id;
      for (const ns of ALL_NAMESPACES) {
        await grantNamespace(client, userId, ns);
      }
      return userId;
    });
  } finally {
    await pool.end();
  }
}

/** Ponto de entrada CLI. */
async function main(): Promise<void> {
  const email = process.argv[2] ?? process.env.HUBCENTRAL_ADMIN_EMAIL;
  const password = process.argv[3] ?? process.env.HUBCENTRAL_ADMIN_PASSWORD;
  const fullName = process.argv[4] ?? process.env.HUBCENTRAL_ADMIN_NAME ?? "Super Administrador";

  if (!email || !password) {
    console.error("Uso: create-admin <email> <senha> [nome]  (ou HUBCENTRAL_ADMIN_EMAIL/PASSWORD)");
    process.exit(1);
  }

  const id = await createAdmin(email, password, fullName);
  console.log(`SuperAdministrador pronto: ${email} (id=${id}).`);
}

// Executa somente quando invocado diretamente (não em import de teste).
if (process.argv[1] && process.argv[1].endsWith("create-admin.js")) {
  main().catch((err) => {
    console.error("Falha ao criar SuperAdministrador:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
