import { closePool, query } from '../db/pool.js';
import { config } from '../config/index.js';

async function main(): Promise<void> {
  const url = new URL(config.DATABASE_URL);
  console.log(`host: ${url.hostname}`);
  console.log(`base: ${url.pathname.replace('/', '')}`);
  console.log('conectando...');

  const started = Date.now();
  const rows = await query<{ v: string; db: string; usr: string }>(
    'select version() as v, current_database() as db, current_user as usr',
  );
  const row = rows[0];
  if (!row) {
    throw new Error('la consulta no devolvio filas');
  }

  console.log(`conectado en ${Date.now() - started}ms`);
  console.log(`  ${row.v.split(',')[0]}`);
  console.log(`  base=${row.db} rol=${row.usr}`);

  const tables = await query<{ n: string }>(
    `select count(*)::text as n from information_schema.tables where table_schema = 'public'`,
  );
  console.log(`  tablas existentes: ${tables[0]?.n ?? '0'}`);
}

main()
  .catch((error: unknown) => {
    console.error('FALLO:', error instanceof Error ? error.message : error);
    if (error instanceof Error && 'code' in error) {
      console.error('codigo:', (error as { code?: unknown }).code);
    }
    process.exitCode = 1;
  })
  .finally(() => {
    void closePool();
  });
