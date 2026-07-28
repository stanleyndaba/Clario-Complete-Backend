import { Pool, PoolClient, QueryResult } from 'pg';
import config from '../config/env';

let pool: Pool | null = null;

function getPool(): Pool {
  if (!config.DATABASE_URL) {
    throw new Error('DATABASE_URL is required for transactional database operations');
  }

  if (!pool) {
    pool = new Pool({
      connectionString: config.DATABASE_URL,
      ssl: config.DATABASE_URL.includes('sslmode=require') ? undefined : { rejectUnauthorized: false },
    });
  }

  return pool;
}

export type TransactionClient = Pick<PoolClient, 'query'>;

export async function withPostgresTransaction<T>(
  operation: (client: TransactionClient) => Promise<T>
): Promise<T> {
  const client = await getPool().connect();

  try {
    await client.query('BEGIN');
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function postgresQuery<T = any>(sql: string, params: any[] = []): Promise<QueryResult<T>> {
  return getPool().query<T>(sql, params);
}
