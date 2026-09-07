import { Pool } from 'pg';
import type { PoolClient, QueryResultRow } from 'pg';
import { config } from '../config/index.js';

function hardenSsl(connectionString: string): string {
  if (!/[?&]sslmode=/.test(connectionString)) {
    return connectionString;
  }
  return connectionString.replace(/([?&])sslmode=(require|prefer|allow)/, '$1sslmode=verify-full');
}

export const pool = new Pool({
  connectionString: hardenSsl(config.DATABASE_URL),
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 20_000,
  statement_timeout: 120_000,
});

pool.on('error', (error) => {
  console.error('[db] error inesperado en cliente idle', error);
});

export async function query<T extends QueryResultRow>(
  sql: string,
  params: readonly unknown[] = [],
): Promise<T[]> {
  const result = await pool.query<T>(sql, params as unknown[]);
  return result.rows;
}

export async function queryOne<T extends QueryResultRow>(
  sql: string,
  params: readonly unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  await pool.end();
}
