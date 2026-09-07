import { closePool, query } from '../db/pool.js';
import { listTrackedInstruments } from '../instruments/catalog.js';
import { buildEventSpecs, minimumHistoryBars } from '../predictions/build.js';
import { barsPerWindow, eventKey } from '../predictions/events.js';
import type { Horizon } from '../predictions/events.js';
import { allModels } from '../models/registry.js';
import type { HistoryBar } from '../predictions/build.js';

const HORIZONS: Horizon[] = ['1d', '7d'];

async function loadHistory(instrumentId: number, limit: number): Promise<HistoryBar[]> {
  const rows = await query<{ bar_date: string; adj_close: string }>(
    `select bar_date::text as bar_date, adj_close::text
     from ohlcv_bar
     where instrument_id = $1 and bar_interval = '1d'
     order by bar_date desc
     limit $2`,
    [instrumentId, limit],
  );

  return rows
    .map((row) => ({ barDate: row.bar_date, adjClose: Number(row.adj_close) }))
    .reverse();
}

async function main(): Promise<void> {
  const instruments = await listTrackedInstruments();
  const models = allModels();

  for (const instrument of instruments) {
    console.log(`\n### ${instrument.symbol} (${instrument.asset_class})`);

    for (const horizon of HORIZONS) {
      const windowBars = barsPerWindow(instrument.asset_class, horizon);
      const required = Math.max(
        minimumHistoryBars(horizon, instrument.asset_class),
        ...models.map((model) => model.minimumHistory(windowBars)),
      );
      const history = await loadHistory(instrument.id, Math.max(required, 400));

      if (history.length < required) {
        console.log(`  ${horizon}: historial insuficiente (${history.length}/${required})`);
        continue;
      }

      const specs = buildEventSpecs({
        assetClass: instrument.asset_class,
        horizon,
        history,
      });

      for (const spec of specs) {
        const detail =
          spec.type === 'MAG'
            ? `umbral=${(spec.params.thresholdAbs * 100).toFixed(2)}%`
            : spec.type === 'VOL'
              ? `rvPrev=${(spec.params.rvPrevious * 100).toFixed(3)}%`
              : '';

        const cells = models.map((model) => {
          if (!model.supports(spec.type)) {
            return `${model.key}=-`;
          }
          const probability = model.predict({
            assetClass: instrument.asset_class,
            horizon,
            windowBars,
            spec,
            history,
          });
          return `${model.key}=${probability.toFixed(3)}`;
        });

        console.log(
          `  ${horizon} ${eventKey(spec).padEnd(16)} ${detail.padEnd(18)} ${cells.join('  ')}`,
        );
      }
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
