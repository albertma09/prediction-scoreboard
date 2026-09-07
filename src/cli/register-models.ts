import { closePool, query } from '../db/pool.js';
import { allModels, computeCodeHash, registerAllModels, registerModel } from '../models/registry.js';

async function main(): Promise<void> {
  const ids = await registerAllModels();
  for (const [key, id] of ids) {
    console.log(`${key.padEnd(14)} id=${id}`);
  }

  console.log('');
  console.log('=== guard de deriva de codigo ===');
  const target = allModels()[0];
  if (!target) {
    throw new Error('no hay modelos registrados');
  }

  const mutated = { ...target, predict: () => 0.42 };
  console.log(`  hash original: ${computeCodeHash(target).slice(0, 16)}...`);
  console.log(`  hash mutado:   ${computeCodeHash(mutated).slice(0, 16)}...`);

  try {
    await registerModel(mutated);
    console.log('  TEST FALLIDO: acepto codigo cambiado sin subir la version');
  } catch (error) {
    const first =
      error instanceof Error ? error.message.split(/\r?\n/)[0] : String(error);
    console.log(`  rechazado ok: ${first}`);
  }

  const rows = await query<{ model_key: string; version: string; is_baseline: boolean }>(
    'select model_key, version, is_baseline from model_version order by model_key',
  );
  console.log('');
  console.log('=== registrados en BD ===');
  for (const row of rows) {
    console.log(`  ${row.model_key}@${row.version} baseline=${row.is_baseline}`);
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
