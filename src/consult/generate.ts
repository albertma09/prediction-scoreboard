import { query, withTransaction } from '../db/pool.js';
import { listAllInstruments } from '../instruments/catalog.js';
import { buildEventSpecs, minimumHistoryBars } from '../predictions/build.js';
import type { HistoryBar } from '../predictions/build.js';
import { barsPerWindow, eventKey } from '../predictions/events.js';
import type { Horizon } from '../predictions/events.js';
import { clampProbability } from '../predictions/canonical.js';
import { allModels } from '../models/registry.js';
import { preferredRow } from './preference.js';

const HORIZONS: Horizon[] = ['1d', '7d'];

export interface ConsultationReport {
  runId: number;
  covered: number;
  skipped: number;
  rows: number;
  skippedSymbols: string[];
}

async function loadHistory(instrumentId: number): Promise<HistoryBar[]> {
  const rows = await query<{ bar_date: string; adj_close: string }>(
    `select bar_date::text as bar_date, adj_close::text
     from ohlcv_bar
     where instrument_id = $1 and bar_interval = '1d'
     order by bar_date asc`,
    [instrumentId],
  );
  return rows.map((row) => ({ barDate: row.bar_date, adjClose: Number(row.adj_close) }));
}

export async function generateConsultations(): Promise<ConsultationReport> {
  const runRows = await query<{ id: number }>(
    'insert into consultation_run default values returning id',
  );
  const runId = runRows[0]?.id;
  if (runId === undefined) {
    throw new Error('no se pudo abrir el consultation_run');
  }

  const instruments = await listAllInstruments();
  const models = allModels();

  let covered = 0;
  let skipped = 0;
  let rows = 0;
  const skippedSymbols: string[] = [];

  for (const instrument of instruments) {
    const history = await loadHistory(instrument.id);
    const lastBar = history[history.length - 1];

    if (!lastBar) {
      skipped += 1;
      skippedSymbols.push(instrument.symbol);
      continue;
    }

    let wroteAny = false;

    for (const horizon of HORIZONS) {
      const windowBars = barsPerWindow(instrument.asset_class, horizon);
      const required = Math.max(
        minimumHistoryBars(horizon, instrument.asset_class),
        ...models.map((model) => model.minimumHistory(windowBars)),
      );

      if (history.length < required) {
        continue;
      }

      const specs = buildEventSpecs({
        assetClass: instrument.asset_class,
        horizon,
        history,
      });

      const batch: Array<{
        horizon: Horizon;
        eventType: string;
        eventKey: string;
        eventParams: string;
        modelKey: string;
        modelVersion: string;
        probability: number;
      }> = [];

      for (const spec of specs) {
        for (const model of models) {
          if (!model.supports(spec.type)) {
            continue;
          }
          try {
            const probability = clampProbability(
              model.predict({
                assetClass: instrument.asset_class,
                horizon,
                windowBars,
                spec,
                history,
              }),
            );
            batch.push({
              horizon,
              eventType: spec.type,
              eventKey: eventKey(spec),
              eventParams: JSON.stringify(spec.params),
              modelKey: model.key,
              modelVersion: model.version,
              probability,
            });
          } catch {
            continue;
          }
        }
      }

      if (batch.length === 0) {
        continue;
      }

      await withTransaction(async (client) => {
        for (const item of batch) {
          await client.query(
            `insert into consultation
               (instrument_id, horizon, event_type, event_key, event_params,
                model_key, model_version, probability, computed_at,
                base_bar_date, history_bars)
             values ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, now(), $9::date, $10)
             on conflict (instrument_id, horizon, event_key, model_key) do update set
               event_params = excluded.event_params,
               model_version = excluded.model_version,
               probability = excluded.probability,
               computed_at = excluded.computed_at,
               base_bar_date = excluded.base_bar_date,
               history_bars = excluded.history_bars`,
            [
              instrument.id,
              item.horizon,
              item.eventType,
              item.eventKey,
              item.eventParams,
              item.modelKey,
              item.modelVersion,
              item.probability,
              lastBar.barDate,
              history.length,
            ],
          );
        }
      });

      rows += batch.length;
      wroteAny = true;
    }

    if (wroteAny) {
      covered += 1;
    } else {
      skipped += 1;
      skippedSymbols.push(instrument.symbol);
    }
  }

  await query(
    `update consultation_run
     set finished_at = now(), status = 'ok',
         instruments_covered = $2, instruments_skipped = $3, rows_written = $4
     where id = $1`,
    [runId, covered, skipped, rows],
  );

  return { runId, covered, skipped, rows, skippedSymbols };
}

export interface ConsultationView {
  horizon: Horizon;
  eventType: string;
  eventKey: string;
  eventParams: Record<string, unknown>;
  bestModelKey: string;
  probability: number;
  climatologyProbability: number | null;
  computedAt: string;
  baseBarDate: string;
}

export async function consultationsFor(instrumentId: number): Promise<ConsultationView[]> {
  const rows = await query<{
    horizon: string;
    event_type: string;
    event_key: string;
    event_params: Record<string, unknown>;
    model_key: string;
    probability: string;
    computed_at: string;
    base_bar_date: string;
  }>(
    `select horizon, event_type, event_key, event_params, model_key,
            probability::text, computed_at::text, base_bar_date::text
     from consultation
     where instrument_id = $1
     order by horizon, event_key, model_key`,
    [instrumentId],
  );

  const grouped = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = `${row.horizon}|${row.event_key}`;
    const list = grouped.get(key) ?? [];
    list.push(row);
    grouped.set(key, list);
  }

  const views: ConsultationView[] = [];

  for (const list of grouped.values()) {
    const preferred = preferredRow(list);
    if (!preferred) {
      continue;
    }
    const climatology = list.find((row) => row.model_key === 'climatology');

    views.push({
      horizon: preferred.horizon === '1d' ? '1d' : '7d',
      eventType: preferred.event_type,
      eventKey: preferred.event_key,
      eventParams: preferred.event_params,
      bestModelKey: preferred.model_key,
      probability: Number(preferred.probability),
      climatologyProbability: climatology ? Number(climatology.probability) : null,
      computedAt: preferred.computed_at,
      baseBarDate: preferred.base_bar_date,
    });
  }

  return views;
}
