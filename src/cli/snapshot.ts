import { closePool } from '../db/pool.js';
import { exportSnapshot } from '../snapshot/export.js';

const DEFAULT_ROOT = 'panel/public/data';

async function main(): Promise<void> {
  const outArg = process.argv.find((arg) => arg.startsWith('--out='));
  const root = outArg === undefined ? DEFAULT_ROOT : (outArg.split('=')[1] ?? DEFAULT_ROOT);

  const started = Date.now();
  const report = await exportSnapshot(root);

  console.log(`snapshot en ${report.root}`);
  console.log(`  ficheros    : ${report.files}`);
  console.log(`  tamanio     : ${(report.bytes / 1024).toFixed(1)} KB`);
  console.log(`  instrumentos: ${report.instruments}`);
  console.log(`  generado    : ${report.generatedAt}`);
  console.log(`  tiempo      : ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => {
    void closePool();
  });
