import { closePool } from '../db/pool.js';
import { searchInstruments } from '../instruments/search.js';

const QUERIES = [
  'bitcoin',
  'btc',
  'nvidia',
  'nvida',
  'sp 500',
  'oro',
  'inditex',
  'ibex',
  'tecnologia',
  'volatilidad',
  'apple',
  'aple',
  'eurostoxx',
  'ferrari',
  'zzzzqqqq',
];

async function main(): Promise<void> {
  for (const q of QUERIES) {
    const started = Date.now();
    const results = await searchInstruments(q, 4);
    const elapsed = Date.now() - started;

    if (results.length === 0) {
      console.log(`${q.padEnd(12)} -> sin resultados  ${elapsed}ms`);
      continue;
    }

    const summary = results
      .map((r) => {
        const badge = r.isTracked ? `T:${r.scoredCount}` : 'no-track';
        return `${r.symbol}(${badge},${r.score.toFixed(2)})`;
      })
      .join(' ');

    console.log(`${q.padEnd(12)} -> [${results[0]?.origin}] ${summary}  ${elapsed}ms`);
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
