import { closePool } from '../db/pool.js';
import { emitForSlot } from '../schedule/emit.js';

async function main(): Promise<void> {
  const report = await emitForSlot();

  console.log(`slot ${report.slotDate} (run ${report.runId})`);
  console.log(`  estado                : ${report.status}`);
  console.log(`  emitidas              : ${report.emitted}`);
  console.log(`  ya existian           : ${report.alreadyPresent}`);
  console.log(`  saltadas sin sesion   : ${report.skippedNoSession}`);
  console.log(`  saltadas sin historial: ${report.skippedNoHistory}`);
  console.log(`  retraso del slot      : ${report.minutesLate} min`);

  for (const note of report.notes) {
    console.log(`  nota: ${note}`);
  }

  if (report.status === 'failed') {
    process.exitCode = 1;
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
