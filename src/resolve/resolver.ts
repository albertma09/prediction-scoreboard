import { query, withTransaction } from '../db/pool.js';
import { sha256 } from '../predictions/canonical.js';
import { parseEventSpec, parseHorizon } from '../predictions/parse.js';
import { attemptResolution } from './window.js';
import type { WindowBar } from './window.js';
import type { AssetClass } from '../config/index.js';
import { POLICY_VERSION, RESOLVER_VERSION } from '../config/policy.js';

export { RESOLVER_VERSION };

interface PendingRow {
  id: number;
  instrument_id: number;
  asset_class: AssetClass;
  symbol: string;
  event_type: string;
  event_params: unknown;
  horizon: string;
  t0_date: string;
  window_end_date: string;
}

export interface ResolveReport {
  resolved: number;
  voided: number;
  deferred: number;
  details: Array<{
    predictionId: number;
    symbol: string;
    eventType: string;
    horizon: string;
    outcome: 0 | 1 | null;
    voidReason: string | null;
    deferred: boolean;
  }>;
}

async function loadPending(limit: number): Promise<PendingRow[]> {
  return query<PendingRow>(
    `select p.id, p.instrument_id, i.asset_class, i.symbol,
            p.event_type, p.event_params, p.horizon,
            (p.t0_utc at time zone 'UTC')::date::text as t0_date,
            (p.window_end_utc at time zone 'UTC')::date::text as window_end_date
     from prediction p
     join instrument i on i.id = p.instrument_id
     left join resolution r on r.prediction_id = p.id
     where r.prediction_id is null
       and p.window_end_utc <= now()
     order by p.id asc
     limit $1`,
    [limit],
  );
}

async function loadBars(
  instrumentId: number,
  fromDate: string,
  toDate: string,
): Promise<WindowBar[]> {
  const rows = await query<{ bar_date: string; adj_close: string }>(
    `select bar_date::text as bar_date, adj_close::text
     from ohlcv_bar
     where instrument_id = $1 and bar_interval = '1d'
       and bar_date >= ($2::date - interval '30 days')
       and bar_date <= $3::date
     order by bar_date asc`,
    [instrumentId, fromDate, toDate],
  );

  return rows.map((row) => ({ barDate: row.bar_date, adjClose: Number(row.adj_close) }));
}

async function latestBarDate(instrumentId: number): Promise<string | null> {
  const rows = await query<{ last_date: string | null }>(
    `select max(bar_date)::text as last_date
     from ohlcv_bar
     where instrument_id = $1 and bar_interval = '1d'`,
    [instrumentId],
  );
  return rows[0]?.last_date ?? null;
}

export async function resolvePending(limit = 5000): Promise<ResolveReport> {
  const pending = await loadPending(limit);
  const report: ResolveReport = { resolved: 0, voided: 0, deferred: 0, details: [] };

  for (const row of pending) {
    const horizon = parseHorizon(row.horizon);
    const spec = parseEventSpec(row.event_type, row.event_params);

    const lastBar = await latestBarDate(row.instrument_id);
    if (lastBar === null || lastBar < row.window_end_date) {
      report.deferred += 1;
      report.details.push({
        predictionId: row.id,
        symbol: row.symbol,
        eventType: row.event_type,
        horizon: row.horizon,
        outcome: null,
        voidReason: null,
        deferred: true,
      });
      continue;
    }

    const bars = await loadBars(row.instrument_id, row.t0_date, row.window_end_date);
    const attempt = attemptResolution(
      spec,
      row.asset_class,
      horizon,
      bars,
      row.t0_date,
      row.window_end_date,
    );

    const inputsJson = JSON.stringify({
      policyVersion: POLICY_VERSION,
      resolverVersion: RESOLVER_VERSION,
      t0Date: row.t0_date,
      windowEndDate: row.window_end_date,
      baseBar: attempt.inputs.baseBar,
      endBar: attempt.inputs.endBar,
      windowBars: attempt.inputs.windowBars,
      simpleReturn: attempt.inputs.simpleReturn,
      realizedVolatility: attempt.inputs.realizedVolatility,
    });

    await withTransaction(async (client) => {
      await client.query(
        `insert into resolution
           (prediction_id, outcome, resolution_inputs, inputs_hash, resolver_version, void_reason)
         values ($1, $2, $3::jsonb, $4, $5, $6)`,
        [
          row.id,
          attempt.outcome,
          inputsJson,
          sha256(inputsJson),
          RESOLVER_VERSION,
          attempt.voidReason,
        ],
      );
    });

    if (attempt.voidReason === null) {
      report.resolved += 1;
    } else {
      report.voided += 1;
    }

    report.details.push({
      predictionId: row.id,
      symbol: row.symbol,
      eventType: row.event_type,
      horizon: row.horizon,
      outcome: attempt.outcome,
      voidReason: attempt.voidReason,
      deferred: false,
    });
  }

  return report;
}
