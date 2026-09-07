import type { PoolClient } from 'pg';
import { query, withTransaction } from '../db/pool.js';
import { listTrackedInstruments } from '../instruments/catalog.js';
import type { InstrumentRow } from '../instruments/catalog.js';
import { buildEventSpecs, minimumHistoryBars } from '../predictions/build.js';
import type { HistoryBar } from '../predictions/build.js';
import {
  barsPerWindow,
  calendarDaysFor,
  eventKey,
} from '../predictions/events.js';
import type { EventSpec, Horizon } from '../predictions/events.js';
import { clampProbability } from '../predictions/canonical.js';
import { allModels } from '../models/registry.js';
import { attemptResolution } from '../resolve/window.js';
import { addDaysUtc } from '../util/dates.js';
import { brierScore } from '../eval/brier.js';

const HORIZONS: Horizon[] = ['1d', '7d'];
const INSERT_CHUNK = 1000;

export interface BacktestOptions {
  label: string;
  maxDays?: number;
  stride?: number;
}

interface PendingScore {
  instrumentId: number;
  horizon: Horizon;
  eventType: string;
  eventKey: string;
  modelKey: string;
  modelVersion: string;
  t0Date: string;
  windowEndDate: string;
  probability: number;
  outcome: 0 | 1 | null;
  voidReason: string | null;
  brier: number | null;
}

async function loadAllBars(instrumentId: number): Promise<HistoryBar[]> {
  const rows = await query<{ bar_date: string; adj_close: string }>(
    `select bar_date::text as bar_date, adj_close::text
     from ohlcv_bar
     where instrument_id = $1 and bar_interval = '1d'
     order by bar_date asc`,
    [instrumentId],
  );
  return rows.map((row) => ({ barDate: row.bar_date, adjClose: Number(row.adj_close) }));
}

export async function runBacktest(options: BacktestOptions): Promise<{
  runId: number;
  observations: number;
  voided: number;
}> {
  const stride = options.stride ?? 1;
  const instruments = await listTrackedInstruments();
  const models = allModels();

  const runRows = await query<{ id: number }>(
    `insert into backtest_run (label, policy_version, config)
     values ($1, '1', $2::jsonb)
     returning id`,
    [
      options.label,
      JSON.stringify({
        stride,
        maxDays: options.maxDays ?? null,
        models: models.map((model) => `${model.key}@${model.version}`),
        horizons: HORIZONS,
      }),
    ],
  );

  const runId = runRows[0]?.id;
  if (runId === undefined) {
    throw new Error('no se pudo crear el backtest_run');
  }

  let observations = 0;
  let voided = 0;
  let buffer: PendingScore[] = [];

  const flush = async (): Promise<void> => {
    if (buffer.length === 0) {
      return;
    }
    const batch = buffer;
    buffer = [];
    await withTransaction(async (client) => {
      await insertScores(client, runId, batch);
    });
  };

  for (const instrument of instruments) {
    const bars = await loadAllBars(instrument.id);

    for (const horizon of HORIZONS) {
      const windowBars = barsPerWindow(instrument.asset_class, horizon);
      const requiredHistory = Math.max(
        minimumHistoryBars(horizon, instrument.asset_class),
        ...models.map((model) => model.minimumHistory(windowBars)),
      );
      const calendarDays = calendarDaysFor(horizon);

      const startIndex = requiredHistory;
      const endIndex = bars.length - 1;
      const firstIndex =
        options.maxDays === undefined
          ? startIndex
          : Math.max(startIndex, endIndex - options.maxDays);

      for (let index = firstIndex; index <= endIndex; index += stride) {
        const t0Bar = bars[index];
        if (!t0Bar) {
          continue;
        }
        const t0Date = t0Bar.barDate;
        const windowEndDate = addDaysUtc(t0Date, calendarDays);

        const lastBar = bars[bars.length - 1];
        if (!lastBar || lastBar.barDate < windowEndDate) {
          break;
        }

        const history = bars.slice(0, index);
        if (history.length < requiredHistory) {
          continue;
        }

        let specs: EventSpec[];
        try {
          specs = buildEventSpecs({
            assetClass: instrument.asset_class,
            horizon,
            history,
          });
        } catch {
          continue;
        }

        for (const spec of specs) {
          const attempt = attemptResolution(
            spec,
            instrument.asset_class,
            horizon,
            bars,
            t0Date,
            windowEndDate,
          );

          for (const model of models) {
            if (!model.supports(spec.type)) {
              continue;
            }

            let probability: number;
            try {
              probability = clampProbability(
                model.predict({
                  assetClass: instrument.asset_class,
                  horizon,
                  windowBars,
                  spec,
                  history,
                }),
              );
            } catch {
              continue;
            }

            const brier =
              attempt.outcome === null ? null : brierScore(probability, attempt.outcome);

            buffer.push({
              instrumentId: instrument.id,
              horizon,
              eventType: spec.type,
              eventKey: eventKey(spec),
              modelKey: model.key,
              modelVersion: model.version,
              t0Date,
              windowEndDate,
              probability,
              outcome: attempt.outcome,
              voidReason: attempt.voidReason,
              brier,
            });

            if (attempt.voidReason === null) {
              observations += 1;
            } else {
              voided += 1;
            }
          }
        }

        if (buffer.length >= INSERT_CHUNK) {
          await flush();
        }
      }
    }
  }

  await flush();

  await query(
    `update backtest_run
     set finished_at = now(), observations = $2
     where id = $1`,
    [runId, observations],
  );

  return { runId, observations, voided };
}

async function insertScores(
  client: PoolClient,
  runId: number,
  scores: PendingScore[],
): Promise<void> {
  const columns = 13;
  const placeholders: string[] = [];
  const values: unknown[] = [];

  scores.forEach((score, index) => {
    const base = index * columns;
    placeholders.push(
      `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, ` +
        `$${base + 6}, $${base + 7}, $${base + 8}::date, $${base + 9}::date, ` +
        `$${base + 10}, $${base + 11}, $${base + 12}, $${base + 13})`,
    );
    values.push(
      runId,
      score.instrumentId,
      score.horizon,
      score.eventType,
      score.eventKey,
      score.modelKey,
      score.modelVersion,
      score.t0Date,
      score.windowEndDate,
      score.probability,
      score.outcome,
      score.voidReason,
      score.brier,
    );
  });

  await client.query(
    `insert into backtest_score
       (run_id, instrument_id, horizon, event_type, event_key, model_key, model_version,
        t0_date, window_end_date, probability, outcome, void_reason, brier)
     values ${placeholders.join(', ')}`,
    values,
  );
}

export async function pruneBacktestRuns(keepRunId: number): Promise<number> {
  const deleted = await query<{ id: number }>(
    'delete from backtest_run where id <> $1 returning id',
    [keepRunId],
  );
  return deleted.length;
}

export type { InstrumentRow };
