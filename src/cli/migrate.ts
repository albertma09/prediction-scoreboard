import { closePool } from '../db/pool.js';
import { runMigrations } from '../db/migrate.js';

async function main(): Promise<void> {
  const executed = await runMigrations();
  if (executed.length === 0) {
    console.log('sin migraciones pendientes');
    return;
  }
  for (const name of executed) {
    console.log(`aplicada ${name}`);
  }
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => {
    void closePool();
  });
