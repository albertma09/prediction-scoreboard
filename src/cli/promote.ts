import { closePool } from '../db/pool.js';
import { getInstrumentBySymbol, setTracked } from '../instruments/catalog.js';
import { ingestInstrument } from '../ingest/ohlcv.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const demote = args.includes('--demote');
  const symbols = args.filter((arg) => !arg.startsWith('--'));

  if (symbols.length === 0) {
    console.log('uso: npm run promote <SIMBOLO> [<SIMBOLO>...] [--demote]');
    process.exitCode = 1;
    return;
  }

  for (const symbol of symbols) {
    const existing = await getInstrumentBySymbol(symbol);
    if (!existing) {
      console.error(`${symbol}: no esta en el catalogo, buscalo primero`);
      process.exitCode = 1;
      continue;
    }

    if (demote) {
      await setTracked(symbol, false);
      console.log(`${existing.symbol}: retirado del universo puntuable`);
      continue;
    }

    if (existing.is_tracked) {
      console.log(`${existing.symbol}: ya estaba trackeado`);
      continue;
    }

    const instrument = await setTracked(symbol, true);
    const report = await ingestInstrument(instrument, { fullBackfill: true });
    console.log(
      `${instrument.symbol}: promovido, backfill ${report.fromDate} -> ${report.toDate}, ` +
        `${report.inserted} barras`,
    );
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
