import { closePool } from '../db/pool.js';
import { registerAllModels } from '../models/registry.js';
import { runBacktest } from '../backtest/run.js';
import { buildSliceReports, calibrationFor, loadBacktestScores } from '../eval/report.js';

function flagValue(args: string[], name: string): string | null {
  const index = args.indexOf(name);
  if (index === -1 || index + 1 >= args.length) {
    return null;
  }
  return args[index + 1] ?? null;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const label = flagValue(args, '--label') ?? `backtest ${new Date().toISOString()}`;
  const maxDaysRaw = flagValue(args, '--max-days');
  const strideRaw = flagValue(args, '--stride');

  await registerAllModels();

  const started = Date.now();
  const result = await runBacktest({
    label,
    ...(maxDaysRaw === null ? {} : { maxDays: Number(maxDaysRaw) }),
    ...(strideRaw === null ? {} : { stride: Number(strideRaw) }),
  });

  console.log(
    `run ${result.runId}: ${result.observations} observaciones puntuadas, ` +
      `${result.voided} nulas, ${((Date.now() - started) / 1000).toFixed(1)}s`,
  );

  const rows = await loadBacktestScores(result.runId);
  const reports = buildSliceReports(rows, { perSymbol: false, bootstrapIterations: 600 });

  console.log('');
  console.log('=== BSS AGREGADO vs baseline 0.5 (todos los activos juntos) ===');
  console.log(
    'horiz  evento           modelo        N      Nef   tasaBase  Brier    BSS_050   IC95              BSS_clim',
  );

  for (const report of reports) {
    const ci = `[${report.bssVsCoinflipLower.toFixed(3)}, ${report.bssVsCoinflipUpper.toFixed(3)}]`;
    const marker = report.crossesZero ? ' cruza-0' : '';
    const bssClim =
      report.bssVsClimatology === null ? '   -   ' : report.bssVsClimatology.toFixed(4);

    console.log(
      `${report.horizon.padEnd(6)} ${report.eventKey.padEnd(16)} ` +
        `${report.modelKey.padEnd(13)} ${String(report.count).padStart(5)} ` +
        `${String(report.effectiveObservations).padStart(5)}  ` +
        `${report.baseRate.toFixed(4).padStart(8)}  ${report.modelBrier.toFixed(4)}  ` +
        `${report.bssVsCoinflip.toFixed(4).padStart(8)}  ${ci.padEnd(17)} ${bssClim}${marker}`,
    );
  }

  console.log('');
  console.log('=== CALIBRACION de ewmaVol (todos los eventos que soporta) ===');
  const bins = calibrationFor(rows, 'ewmaVol');
  console.log('bin           N      predicho  observado');
  for (const bin of bins) {
    if (bin.count === 0) {
      continue;
    }
    console.log(
      `${bin.lowerBound.toFixed(1)}-${bin.upperBound.toFixed(1)}   ` +
        `${String(bin.count).padStart(6)}  ${bin.meanForecast.toFixed(4).padStart(8)}  ` +
        `${bin.observedFrequency.toFixed(4).padStart(9)}`,
    );
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
