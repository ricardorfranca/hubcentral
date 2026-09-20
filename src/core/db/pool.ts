/**
 * @file pool.ts
 * @module core/db
 *
 * Ponto único de acesso ao PostgreSQL do HUB Central. Todos os serviços do
 * núcleo (`core`) e o acesso por referência dos módulos satélites (`mod_*`)
 * compartilham este pool de conexões.
 *
 * A URL de conexão é lida da variável de ambiente `DATABASE_URL`. Não há
 * fallback embutido para evitar que credenciais fiquem hardcoded no código.
 */

import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";

/**
 * Cria um {@link Pool} de conexões a partir de uma URL de conexão PostgreSQL.
 *
 * @param connectionString - URL no formato `postgres://user:pass@host:port/db`.
 *   Quando omitido, usa `process.env.DATABASE_URL`.
 * @returns Um pool de conexões pronto para uso.
 * @throws {Error} Se nenhuma URL de conexão for fornecida nem estiver no ambiente.
 */
export function createPool(connectionString?: string): Pool {
  const url = connectionString ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL não configurada. Defina a variável de ambiente ou passe a connectionString.",
    );
  }
  return new Pool({ connectionString: url });
}

/**
 * Executa `fn` dentro de uma transação, fazendo COMMIT em caso de sucesso e
 * ROLLBACK caso `fn` lance uma exceção. Garante a atomicidade exigida pelo
 * design (escrita de dados + evento no outbox na mesma transação).
 *
 * @typeParam T - Tipo do valor retornado por `fn`.
 * @param pool - Pool de conexões de origem.
 * @param fn - Função que recebe o cliente transacional e produz um resultado.
 * @returns O valor retornado por `fn`.
 * @throws Repropaga qualquer erro lançado por `fn` após o ROLLBACK.
 */
export async function withTransaction<T>(
  pool: Pool,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Executa uma query parametrizada no pool. Wrapper fino sobre `pool.query`
 * que preserva a tipagem das linhas retornadas.
 *
 * @typeParam R - Formato de cada linha do resultado.
 * @param pool - Pool de conexões.
 * @param text - SQL com placeholders `$1, $2, ...`.
 * @param params - Valores dos placeholders, na ordem.
 * @returns O resultado da query.
 */
export async function query<R extends QueryResultRow = QueryResultRow>(
  pool: Pool,
  text: string,
  params: readonly unknown[] = [],
): Promise<QueryResult<R>> {
  return pool.query<R>(text, params as unknown[]);
}
