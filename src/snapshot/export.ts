import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { query } from '../db/pool.js';
import { listAllInstruments } from '../instruments/catalog.js';
import { consultationsFor } from '../consult/generate.js';
import { buildSliceReports, calibrationFor, loadBacktestScores } from '../eval/report.js';
import { emissionHistory } from '../schedule/emit.js';
import { readHead, verify } from '../ledger/ledger.js';
import { allModels } from '../models/registry.js';
import { SCHEMA_VERSION } from '../predictions/canonical.js';

export const SNAPSHOT_VERSION = '1';

export function slugFor(symbol: string): string {
  return symbol.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toUpperCase();
}

async function writeJson(root: string, relative: string, value: unknown): Promise<number> {
  const path = join(root, relative);
  await mkdir(dirname(path), { recursive: true });
  const body = `${JSON.stringify(value)}\n`;
  await writeFile(path, body, 'utf8');
  return Buffer.byteLength(body, 'utf8');
}

interface LatestBacktest {
  id: number;
  label: string;
  finished_at: string | null;
  observations: number;
}

async function latestBacktest(): Promise<LatestBacktest | null> {
  const rows = await query<LatestBacktest>(
    `select id, label, finished_at::text as finished_at, observations
     from backtest_run where finished_at is not null
     order by finished_at desc limit 1`,
  );
  return rows[0] ?? null;
}

export interface SnapshotReport {
  root: string;
  files: number;
  bytes: number;
  instruments: number;
  generatedAt: string;
}

export async function exportSnapshot(root: string): Promise<SnapshotReport> {
  const generatedAt = new Date().toISOString();
  let files = 0;
  let bytes = 0;

  const track = async (relative: string, value: unknown): Promise<void> => {
    bytes += await writeJson(root, relative, value);
    files += 1;
  };

  const instruments = await listAllInstruments();

  const scoredCounts = new Map<number, number>();
  for (const row of await query<{ instrument_id: number; n: string }>(
    `select p.instrument_id, count(*)::text as n
     from prediction p join resolution r on r.prediction_id = p.id
     where r.outcome is not null
     group by p.instrument_id`,
  )) {
    scoredCounts.set(row.instrument_id, Number(row.n));
  }

  const consultationCounts = new Map<number, number>();
  for (const row of await query<{ instrument_id: number; n: string }>(
    'select instrument_id, count(*)::text as n from consultation group by instrument_id',
  )) {
    consultationCounts.set(row.instrument_id, Number(row.n));
  }

  const aliasRows = await query<{ instrument_id: number; alias: string }>(
    'select instrument_id, alias from instrument_alias',
  );
  const aliases = new Map<number, string[]>();
  for (const row of aliasRows) {
    const list = aliases.get(row.instrument_id) ?? [];
    list.push(row.alias);
    aliases.set(row.instrument_id, list);
  }

  await track(
    'instruments.json',
    instruments.map((instrument) => ({
      symbol: instrument.symbol,
      slug: slugFor(instrument.symbol),
      name: instrument.name,
      assetClass: instrument.asset_class,
      exchange: instrument.exchange,
      currency: instrument.currency,
      isTracked: instrument.is_tracked,
      scoredCount: scoredCounts.get(instrument.id) ?? 0,
      hasConsultation: (consultationCounts.get(instrument.id) ?? 0) > 0,
      aliases: aliases.get(instrument.id) ?? [],
    })),
  );

  const backtest = await latestBacktest();
  let backtestSlices = 0;

  if (backtest) {
    const rows = await loadBacktestScores(backtest.id);
    const slices = buildSliceReports(rows, { perSymbol: false, bootstrapIterations: 600 });
    backtestSlices = slices.length;

    await track('scoreboard.json', {
      source: 'backtest',
      available: true,
      runId: backtest.id,
      label: backtest.label,
      finishedAt: backtest.finished_at,
      observations: backtest.observations,
      slices,
    });

    for (const model of allModels()) {
      await track(`calibration/${model.key}.json`, {
        source: 'backtest',
        available: true,
        modelKey: model.key,
        runId: backtest.id,
        bins: calibrationFor(rows, model.key, 10),
      });
    }
  } else {
    await track('scoreboard.json', { source: 'backtest', available: false, slices: [] });
    for (const model of allModels()) {
      await track(`calibration/${model.key}.json`, {
        source: 'backtest',
        available: false,
        modelKey: model.key,
        bins: [],
      });
    }
  }

  const liveSlices = await query<{
    event_key: string;
    horizon: string;
    model_key: string;
    emitted: string;
    scored: string;
    voided: string;
    brier: string | null;
  }>(
    `select p.event_key, p.horizon, m.model_key,
            count(*)::text as emitted,
            count(r.outcome)::text as scored,
            count(r.void_reason)::text as voided,
            avg(power(p.probability - r.outcome, 2))::text as brier
     from prediction p
     join model_version m on m.id = p.model_version_id
     left join resolution r on r.prediction_id = p.id
     group by p.event_key, p.horizon, m.model_key
     order by p.horizon, p.event_key, m.model_key`,
  );

  await track('scoreboard-live.json', {
    source: 'ledger',
    available: liveSlices.length > 0,
    note: 'el track record real solo cuenta predicciones del ledger, nunca del backtest',
    slices: liveSlices.map((row) => ({
      eventKey: row.event_key,
      horizon: row.horizon,
      modelKey: row.model_key,
      emitted: Number(row.emitted),
      scored: Number(row.scored),
      voided: Number(row.voided),
      meanBrier: row.brier === null ? null : Number(row.brier),
    })),
  });

  const emissions = await emissionHistory(60);
  const attempted = emissions.length;
  const skipped = emissions.filter((run) => run.status === 'skipped_late').length;
  const failed = emissions.filter((run) => run.status === 'failed').length;

  await track('emissions.json', {
    runs: emissions,
    attempted,
    skippedLate: skipped,
    failed,
    skipRate: attempted === 0 ? null : skipped / attempted,
    note:
      'un dia saltado es un hueco permanente: el registro rechaza emitir sobre una ventana ' +
      'ya cerrada. se publica el porcentaje para que el hueco sea visible.',
  });

  const [chain, head] = await Promise.all([verify(), readHead()]);
  await track('ledger.json', {
    ok: chain.ok,
    checked: chain.checked,
    declaredHead: head.headHash,
    recomputedHead: chain.headHash,
    breaks: chain.breaks,
  });

  for (const instrument of instruments) {
    const slug = slugFor(instrument.symbol);

    const prices = await query<{ bar_date: string; close: string; adj_close: string }>(
      `select bar_date::text as bar_date, close::text, adj_close::text
       from ohlcv_bar
       where instrument_id = $1 and bar_interval = '1d'
       order by bar_date desc limit 180`,
      [instrument.id],
    );

    const predictions = await query<{
      id: number;
      event_key: string;
      event_type: string;
      horizon: string;
      probability: string;
      model_key: string;
      model_version: string;
      t0_utc: string;
      window_end_utc: string;
      chain_hash: string;
      outcome: number | null;
      void_reason: string | null;
    }>(
      `select p.id, p.event_key, p.event_type, p.horizon, p.probability::text,
              m.model_key, m.version as model_version,
              p.t0_utc::text, p.window_end_utc::text, p.chain_hash,
              r.outcome, r.void_reason
       from prediction p
       join model_version m on m.id = p.model_version_id
       left join resolution r on r.prediction_id = p.id
       where p.instrument_id = $1
       order by p.t0_utc desc, p.event_key, m.model_key
       limit 400`,
      [instrument.id],
    );

    const consultations = await consultationsFor(instrument.id);

    let backtestRows: unknown[] = [];
    if (backtest) {
      backtestRows = await query<{
        horizon: string;
        event_key: string;
        model_key: string;
        n: string;
        base_rate: string;
        mean_brier: string;
      }>(
        `select horizon, event_key, model_key, count(*)::text as n,
                avg(outcome)::text as base_rate, avg(brier)::text as mean_brier
         from backtest_score
         where run_id = $1 and instrument_id = $2 and outcome is not null
         group by horizon, event_key, model_key
         order by horizon, event_key, model_key`,
        [backtest.id, instrument.id],
      );
    }

    await track(`instrument/${slug}.json`, {
      instrument: {
        symbol: instrument.symbol,
        slug,
        name: instrument.name,
        assetClass: instrument.asset_class,
        exchange: instrument.exchange,
        currency: instrument.currency,
        provider: instrument.provider,
        isTracked: instrument.is_tracked,
        trackedSince: instrument.tracked_since,
      },
      prices: prices
        .map((bar) => ({
          barDate: bar.bar_date,
          close: Number(bar.close),
          adjClose: Number(bar.adj_close),
        }))
        .reverse(),
      consultation: {
        source: 'consultation',
        available: consultations.length > 0,
        note:
          'estimacion calculada con el mismo codigo, pero sin historial puntuado para este ' +
          'activo si no esta en el universo puntuable',
        views: consultations,
      },
      ledger: {
        source: 'ledger',
        scoredCount: scoredCounts.get(instrument.id) ?? 0,
        predictions: predictions.map((row) => ({
          id: row.id,
          eventKey: row.event_key,
          eventType: row.event_type,
          horizon: row.horizon,
          probability: Number(row.probability),
          model: `${row.model_key}@${row.model_version}`,
          t0Utc: row.t0_utc,
          windowEndUtc: row.window_end_utc,
          chainHash: row.chain_hash,
          outcome: row.outcome,
          voidReason: row.void_reason,
        })),
      },
      backtest: backtest
        ? {
            source: 'backtest',
            runId: backtest.id,
            label: backtest.label,
            rows: (backtestRows as Array<Record<string, string>>).map((row) => ({
              horizon: row.horizon,
              eventKey: row.event_key,
              modelKey: row.model_key,
              count: Number(row.n),
              baseRate: Number(row.base_rate),
              meanBrier: Number(row.mean_brier),
            })),
          }
        : null,
    });
  }

  await track('meta.json', {
    snapshotVersion: SNAPSHOT_VERSION,
    payloadSchemaVersion: SCHEMA_VERSION,
    policyVersion: '1',
    generatedAt,
    instruments: instruments.length,
    trackedInstruments: instruments.filter((instrument) => instrument.is_tracked).length,
    ledgerPredictions: chain.checked,
    ledgerOk: chain.ok,
    backtestObservations: backtest?.observations ?? 0,
    backtestSlices,
    emissionRuns: attempted,
    emissionSkippedLate: skipped,
    emissionFailed: failed,
    models: allModels().map((model) => `${model.key}@${model.version}`),
  });

  return { root, files, bytes, instruments: instruments.length, generatedAt };
}
