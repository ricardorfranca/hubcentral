import { Pool, type PoolClient } from "pg";

/**
 * @file db.ts
 *
 * Helpers de banco para a suíte de testes. Conecta ao Postgres efêmero
 * levantado no global-setup (via `TEST_DATABASE_URL`) e oferece isolamento
 * entre casos por meio de uma transação que é sempre revertida (ROLLBACK),
 * deixando o banco no estado inicial após cada teste.
 */

let pool: Pool | undefined;

/**
 * Retorna o pool de conexões da base de teste, criando-o na primeira chamada.
 *
 * @returns O {@link Pool} conectado à base efêmera de teste.
 * @throws {Error} Se `TEST_DATABASE_URL` não estiver definida (setup global não rodou).
 */
export function getTestPool(): Pool {
  if (!pool) {
    const url = process.env.TEST_DATABASE_URL;
    if (!url) {
      throw new Error(
        "TEST_DATABASE_URL não definida. O global-setup do Vitest deve subir o container Postgres antes dos testes.",
      );
    }
    pool = new Pool({ connectionString: url });
  }
  return pool;
}

/**
 * Executa `fn` dentro de uma transação que é SEMPRE revertida ao final,
 * garantindo que nenhum dado escrito pelo teste persista entre casos.
 *
 * Use quando o comportamento sob teste não depende de COMMIT (a maioria dos
 * casos). Para lógica que exige efeitos pós-commit (ex.: despacho do outbox),
 * use uma base dedicada e limpeza explícita.
 *
 * @typeParam T - Tipo do valor retornado por `fn`.
 * @param fn - Função de teste que recebe o cliente transacional.
 * @returns O valor retornado por `fn`.
 */
export async function withRollback<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getTestPool().connect();
  try {
    await client.query("BEGIN");
    return await fn(client);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
}

/**
 * Encerra o pool de teste. Chamado em afterAll quando necessário.
 */
export async function closeTestPool(): Promise<void> {
  await pool?.end();
  pool = undefined;
}
