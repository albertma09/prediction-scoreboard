import { closePool, query } from '../db/pool.js';

async function main(): Promise<void> {
  const rows = await query<{ asset_class: string; provider: string; n: string }>(
    `select asset_class, provider, count(*)::text as n
     from instrument group by asset_class, provider order by asset_class, provider`,
  );
  for (const row of rows) {
    console.log(`  ${row.asset_class.padEnd(8)} -> ${row.provider.padEnd(10)} ${row.n} activos`);
  }

  const tracked = await query<{ symbol: string; provider: string; provider_symbol: string }>(
    `select symbol, provider, provider_symbol from instrument where is_tracked order by symbol`,
  );
  console.log('');
  console.log('  universo puntuable:');
  for (const row of tracked) {
    console.log(`    ${row.symbol.padEnd(8)} ${row.provider.padEnd(10)} ${row.provider_symbol}`);
  }
}

main()
  .catch((e: unknown) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; })
  .finally(() => { void closePool(); });
