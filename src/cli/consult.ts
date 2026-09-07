import { closePool } from '../db/pool.js';
import { registerAllModels } from '../models/registry.js';
import { generateConsultations } from '../consult/generate.js';

async function main(): Promise<void> {
  await registerAllModels();
  const started = Date.now();
  const report = await generateConsultations();

  console.log(`run ${report.runId} en ${((Date.now() - started) / 1000).toFixed(1)}s`);
  console.log(`  instrumentos cubiertos : ${report.covered}`);
  console.log(`  instrumentos saltados  : ${report.skipped}`);
  console.log(`  filas escritas         : ${report.rows}`);

  if (report.skippedSymbols.length > 0) {
    console.log(`  sin datos suficientes  : ${report.skippedSymbols.slice(0, 12).join(' ')}`);
  }
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => {
    void closePool();
  });
