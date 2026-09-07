import { closePool, query } from '../db/pool.js';

const DEAD_SYMBOLS = ['TEF', 'MATICUSD'];

async function main(): Promise<void> {
  for (const symbol of DEAD_SYMBOLS) {
    const bars = await query<{ n: string }>(
      `select count(*)::text as n from ohlcv_bar b
       join instrument i on i.id = b.instrument_id
       where i.symbol = $1`,
      [symbol],
    );
    const predictions = await query<{ n: string }>(
      `select count(*)::text as n from prediction p
       join instrument i on i.id = p.instrument_id
       where i.symbol = $1`,
      [symbol],
    );

    if (Number(predictions[0]?.n ?? 0) > 0) {
      console.log(`${symbol}: tiene predicciones registradas, NO se borra`);
      continue;
    }

    const deleted = await query<{ symbol: string }>(
      'delete from instrument where symbol = $1 returning symbol',
      [symbol],
    );
    if (deleted.length > 0) {
      console.log(`${symbol}: borrado (tenia ${bars[0]?.n ?? 0} barras, 0 predicciones)`);
    } else {
      console.log(`${symbol}: no estaba`);
    }
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
