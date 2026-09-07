import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, withTransaction } from './pool.js';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, '..', '..', 'db', 'migrations');

interface AppliedMigration {
  name: string;
  checksum: string;
}

async function ensureRegistry(): Promise<void> {
  await pool.query(`
    create table if not exists schema_migration (
      name text primary key,
      checksum text not null,
      applied_at timestamptz not null default now()
    )
  `);
}

function checksumOf(sql: string): string {
  return createHash('sha256').update(sql, 'utf8').digest('hex');
}

export async function runMigrations(): Promise<string[]> {
  await ensureRegistry();

  const files = (await readdir(migrationsDir))
    .filter((name) => name.endsWith('.sql'))
    .sort();

  const applied = await pool.query<AppliedMigration>(
    'select name, checksum from schema_migration',
  );
  const appliedByName = new Map(applied.rows.map((row) => [row.name, row.checksum]));

  const executed: string[] = [];

  for (const file of files) {
    const sql = await readFile(join(migrationsDir, file), 'utf8');
    const checksum = checksumOf(sql);
    const previous = appliedByName.get(file);

    if (previous !== undefined) {
      if (previous !== checksum) {
        throw new Error(
          `migracion ya aplicada fue modificada: ${file}\n` +
            `  checksum aplicado: ${previous}\n` +
            `  checksum actual:   ${checksum}\n` +
            'crea una migracion nueva en lugar de editar una aplicada',
        );
      }
      continue;
    }

    await withTransaction(async (client) => {
      await client.query(sql);
      await client.query(
        'insert into schema_migration (name, checksum) values ($1, $2)',
        [file, checksum],
      );
    });

    executed.push(file);
  }

  return executed;
}
