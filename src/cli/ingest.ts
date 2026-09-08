import { closePool } from '../db/pool.js';
import {
  getInstrumentBySymbol,
  listAllInstruments,
  listTrackedInstruments,
} from '../instruments/catalog.js';
import { finishIngestRun, ingestInstrument, startIngestRun } from '../ingest/ohlcv.js';
import { FAILURE_ABORT_RATIO, verdictFor } from '../ingest/verdict.js';
import type { InstrumentRow } from '../instruments/catalog.js';

async function resolveTargets(args: string[]): Promise<InstrumentRow[]> {
  const symbols = args.filter((arg) => !arg.startsWith('--'));

  if (symbols.length === 0) {
    return args.includes('--catalog') ? listAllInstruments() : listTrackedInstruments();
  }

  const targets: InstrumentRow[] = [];
  for (const symbol of symbols) {
    const instrument = await getInstrumentBySymbol(symbol);
    if (!instrument) {
      throw new Error(`instrumento no encontrado en el catalogo: ${symbol}`);
    }
    targets.push(instrument);
  }
  return targets;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const fullBackfill = args.includes('--backfill') || args.includes('--catalog');
  const yearsArg = args.find((arg) => arg.startsWith('--years='));
  const years = yearsArg === undefined ? undefined : Number(yearsArg.split('=')[1]);
  const targets = await resolveTargets(args);

  if (targets.length === 0) {
    console.log('no hay instrumentos trackeados; usa npm run promote <SIMBOLO>');
    return;
  }

  const runId = await startIngestRun(
    args.includes('--catalog') ? 'catalog' : fullBackfill ? 'backfill' : 'incremental',
  );
  let barsWritten = 0;
  const fallen: string[] = [];

  for (const instrument of targets) {
    try {
      const report = await ingestInstrument(instrument, {
        fullBackfill,
        ...(years === undefined ? {} : { years }),
      });
      barsWritten += report.inserted;
      if (!args.includes('--quiet')) {
        console.log(
          `${report.symbol.padEnd(10)} ${report.fromDate} -> ${report.toDate}  ` +
            `descargadas=${String(report.fetched).padStart(5)}  ` +
            `nuevas=${String(report.inserted).padStart(5)}  ` +
            `adj=${report.adjRefreshed}  anomalias=${report.anomalies}`,
        );
      }
    } catch (error) {
      fallen.push(instrument.symbol);
      console.error(
        `${instrument.symbol.padEnd(10)} FALLO ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  const failures = fallen.length;
  const status = failures === 0 ? 'ok' : failures === targets.length ? 'failed' : 'partial';
  await finishIngestRun(
    runId,
    status,
    targets.length,
    barsWritten,
    failures === 0 ? null : `${failures} fallaron: ${fallen.join(' ')}`.slice(0, 2000),
  );

  console.log(`\nrun ${runId}: ${status}, ${barsWritten} barras nuevas`);

  const verdict = verdictFor(failures, targets.length);
  if (verdict === 'ok') {
    return;
  }

  const ratio = failures / targets.length;
  console.warn(`AVISO ${failures}/${targets.length} instrumentos fallaron: ${fallen.join(' ')}`);

  if (verdict === 'averia') {
    console.error(
      `demasiados fallos (${(ratio * 100).toFixed(0)}% > ` +
        `${(FAILURE_ABORT_RATIO * 100).toFixed(0)}%); esto es una averia, no ruido`,
    );
    process.exitCode = 1;
    return;
  }

  console.warn('fallos aislados: el ciclo continua para no perder el resto del dia');
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => {
    void closePool();
  });
