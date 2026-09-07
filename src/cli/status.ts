import { closePool, query } from '../db/pool.js';
import { config } from '../config/index.js';

async function main(): Promise<void> {
  const url = new URL(config.DATABASE_URL);
  console.log(`base de datos: ${url.hostname}`);
  console.log('');

  const rows = await query<{ t: string; n: string }>(
    `select 'tablas' as t, count(*)::text as n
       from information_schema.tables where table_schema = 'public'
     union all select 'instrumentos', count(*)::text from instrument
     union all select 'instrumentos trackeados', count(*)::text from instrument where is_tracked
     union all select 'alias de busqueda', count(*)::text from instrument_alias
     union all select 'barras de precio', count(*)::text from ohlcv_bar
     union all select 'modelos registrados', count(*)::text from model_version
     union all select 'predicciones (ledger)', count(*)::text from prediction
     union all select 'resoluciones', count(*)::text from resolution
     union all select 'observaciones de backtest', count(*)::text from backtest_score`,
  );

  for (const row of rows) {
    console.log(`  ${row.t.padEnd(28)}${row.n.padStart(8)}`);
  }

  const bars = await query<{ symbol: string; n: string; first: string; last: string }>(
    `select i.symbol, count(*)::text as n,
            min(b.bar_date)::text as first, max(b.bar_date)::text as last
     from ohlcv_bar b join instrument i on i.id = b.instrument_id
     group by i.symbol order by i.symbol`,
  );

  if (bars.length > 0) {
    console.log('');
    console.log('  precios por activo:');
    for (const row of bars) {
      console.log(`    ${row.symbol.padEnd(10)}${row.n.padStart(6)} barras  ${row.first} -> ${row.last}`);
    }
  }
}

main()
  .catch((error: unknown) => {
    console.error('FALLO:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => {
    void closePool();
  });
