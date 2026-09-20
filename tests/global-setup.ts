import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * @file global-setup.ts
 *
 * Setup global do Vitest: sobe um container efêmero de PostgreSQL 15, aplica
 * todas as migrations do diretório `migrations/` via node-pg-migrate e publica
 * a connection string em `process.env.TEST_DATABASE_URL` para os testes.
 *
 * O container é encerrado no teardown retornado.
 */

let container: StartedPostgreSqlContainer | undefined;

/**
 * Inicializa o ambiente de teste global.
 *
 * @returns Função de teardown que encerra o container Postgres.
 */
export async function setup(): Promise<() => Promise<void>> {
  container = await new PostgreSqlContainer("postgres:15-alpine")
    .withDatabase("hub_central_test")
    .withUsername("hub")
    .withPassword("hub")
    .start();

  const url = container.getConnectionUri();
  process.env.TEST_DATABASE_URL = url;

  // Aplica as migrations na base efêmera. node-pg-migrate lê a conexão de
  // DATABASE_URL; passamos a URL do container para o processo filho.
  await execFileAsync(
    "npx",
    ["node-pg-migrate", "up", "--no-check-order"],
    { env: { ...process.env, DATABASE_URL: url } },
  );

  return async () => {
    await container?.stop();
  };
}
