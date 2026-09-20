/**
 * @file auth.ts
 * @module http/routes
 *
 * Rotas de autenticação do IAM: login (cria sessão), definição de senha
 * (primeiro acesso/troca) e logout (revoga sessão).
 */

import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { withTransaction } from "../../core/db/pool.js";
import { authenticate, setPassword } from "../../core/iam/identity-service.js";
import { createSession, revokeSession } from "../../core/iam/session-service.js";

/** Extrai o token Bearer do header Authorization, se presente. */
function bearerToken(authorization: string | undefined): string | null {
  if (!authorization) return null;
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  return match ? match[1]! : null;
}

/**
 * Registra as rotas de autenticação na instância Fastify.
 *
 * @param app - Instância Fastify.
 * @param pool - Pool de conexões.
 */
export function registerAuthRoutes(app: FastifyInstance, pool: Pool): void {
  // Login: valida credenciais e cria uma sessão. Sinaliza se precisa trocar senha.
  app.post<{ Body: { email: string; password: string } }>("/api/auth/login", async (request, reply) => {
    const { email, password } = request.body;
    const result = await withTransaction(pool, async (client) => {
      const user = await authenticate(client, email, password);
      const session = await createSession(client, user.id);
      return { user, session };
    });
    return reply.send({
      token: result.session.token,
      expires_at: result.session.expiresAt,
      user: {
        id: result.user.id,
        email: result.user.email,
        role: result.user.role,
        password_set: result.user.password_set,
      },
      must_change_password: !result.user.password_set,
    });
  });

  // Definição de senha (primeiro acesso ou troca). Requer autenticação.
  app.post<{ Body: { new_password: string } }>("/api/auth/set-password", async (request, reply) => {
    const userId = request.userId;
    if (!userId) {
      return reply.status(401).send({ code: "AUTH_UNAUTHORIZED", message: "Requisição não autenticada.", details: {} });
    }
    await withTransaction(pool, (client) => setPassword(client, userId, request.body.new_password));
    return reply.status(204).send();
  });

  // Logout: revoga a sessão do token apresentado.
  app.post("/api/auth/logout", async (request, reply) => {
    const token = bearerToken(request.headers.authorization);
    if (token) {
      await withTransaction(pool, (client) => revokeSession(client, token));
    }
    return reply.status(204).send();
  });
}
