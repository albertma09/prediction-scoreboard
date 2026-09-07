import { closePool } from '../db/pool.js';
import { anchor, readHead, verify } from '../ledger/ledger.js';

async function main(): Promise<void> {
  const shouldAnchor = process.argv.includes('--anchor');
  const report = await verify();
  const head = await readHead();

  console.log(`predicciones en la cadena: ${report.checked}`);
  console.log(`cabecera declarada:        ${head.headHash}`);
  console.log(`cabecera recalculada:      ${report.headHash}`);

  if (report.ok) {
    console.log('estado: CADENA INTACTA');
  } else {
    console.log(`estado: CADENA ROTA (${report.breaks.length} incidencias)`);
    for (const issue of report.breaks) {
      const target = issue.predictionId === null ? 'cabecera' : `prediccion ${issue.predictionId}`;
      console.log(`  [${issue.kind}] ${target}: ${issue.detail}`);
      console.log(`      esperado: ${issue.expected}`);
      console.log(`      hallado:  ${issue.found}`);
    }
    process.exitCode = 1;
    return;
  }

  if (shouldAnchor) {
    const result = await anchor();
    console.log(`anclaje escrito en ${result.path}`);
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
