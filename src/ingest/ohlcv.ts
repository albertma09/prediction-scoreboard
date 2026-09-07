import type { PoolClient } from 'pg';
import { config } from '../config/index.js';
import { query, withTransaction } from '../db/pool.js';
import { getProvider } from '../providers/registry.js';
import type { Bar, BarRepair } from '../providers/PriceProvider.js';
import { addDaysUtc, todayUtc, yearsAgoUtc } from '../util/dates.js';
import type { InstrumentRow } from '../instruments/catalog.js';

const CHUNK_SIZE = 500;

export interface IngestReport {
  symbol: string;
  fetched: number;
  inserted: number;
  adjRefreshed: number;
  anomalies: number;
  fromDate: string;
  toDate: string;
}

interface ExistingBar {
  bar_date: string;
  open: string;
  high: string;
  low: string;
  close: string;
  adj_close: string;
}

export async function ingestInstrument(
  instrument: InstrumentRow,
  options: { fullBackfill?: boolean; years?: number } = {},
): Promise<IngestReport> {
  const provider = getProvider(instrument.provider);
  const toDate = todayUtc();
  const fromDate = await resolveFromDate(
    instrument.id,
    options.fullBackfill ?? false,
    options.years ?? config.BACKFILL_YEARS,
  );

  const { bars, repairs } = await provider.fetchBars(
    instrument.provider_symbol,
    '1d',
    fromDate,
    toDate,
  );

  if (bars.length === 0) {
    return {
      symbol: instrument.symbol,
      fetched: 0,
      inserted: 0,
      adjRefreshed: 0,
      anomalies: 0,
      fromDate,
      toDate,
    };
  }

  const existing = await loadExistingBars(instrument.id, fromDate, toDate);

  return withTransaction(async (client) => {
    const anomalies = await recordRepairs(client, instrument.id, repairs);
    const { fresh, revised, adjChanged } = classifyBars(bars, existing);

    const inserted = await insertBars(client, instrument.id, instrument.provider, fresh);

    for (const bar of revised) {
      const previous = existing.get(bar.barDate);
      await client.query(
        `insert into resolution_anomaly
           (instrument_id, bar_interval, bar_date, field, stored_value, provider_value, note)
         values ($1, '1d', $2, 'close', $3, $4, $5)`,
        [
          instrument.id,
          bar.barDate,
          previous ? Number(previous.close) : null,
          bar.close,
          'el proveedor reviso el OHLC en crudo; la barra almacenada no se modifica',
        ],
      );
    }

    let adjRefreshed = 0;
    for (const bar of adjChanged) {
      const previous = existing.get(bar.barDate);
      await client.query(
        `update ohlcv_bar
         set adj_close = $3, adj_close_updated_at = now()
         where instrument_id = $1 and bar_interval = '1d' and bar_date = $2`,
        [instrument.id, bar.barDate, bar.adjClose],
      );
      await client.query(
        `insert into resolution_anomaly
           (instrument_id, bar_interval, bar_date, field, stored_value, provider_value, note)
         values ($1, '1d', $2, 'adj_close', $3, $4, $5)`,
        [
          instrument.id,
          bar.barDate,
          previous ? Number(previous.adj_close) : null,
          bar.adjClose,
          'adj_close refrescado por split o dividendo',
        ],
      );
      adjRefreshed += 1;
    }

    return {
      symbol: instrument.symbol,
      fetched: bars.length,
      inserted,
      adjRefreshed,
      anomalies: anomalies + revised.length + adjChanged.length,
      fromDate,
      toDate,
    };
  });
}

async function resolveFromDate(
  instrumentId: number,
  fullBackfill: boolean,
  years: number,
): Promise<string> {
  if (fullBackfill) {
    return yearsAgoUtc(years);
  }

  const rows = await query<{ last_date: string | null }>(
    `select max(bar_date)::text as last_date
     from ohlcv_bar
     where instrument_id = $1 and bar_interval = '1d'`,
    [instrumentId],
  );

  const lastDate = rows[0]?.last_date;
  if (!lastDate) {
    return yearsAgoUtc(years);
  }

  return addDaysUtc(lastDate, -5);
}

async function loadExistingBars(
  instrumentId: number,
  fromDate: string,
  toDate: string,
): Promise<Map<string, ExistingBar>> {
  const rows = await query<ExistingBar>(
    `select bar_date::text as bar_date, open::text, high::text, low::text,
            close::text, adj_close::text
     from ohlcv_bar
     where instrument_id = $1 and bar_interval = '1d'
       and bar_date between $2::date and $3::date`,
    [instrumentId, fromDate, toDate],
  );

  return new Map(rows.map((row) => [row.bar_date, row]));
}

function classifyBars(
  bars: Bar[],
  existing: Map<string, ExistingBar>,
): { fresh: Bar[]; revised: Bar[]; adjChanged: Bar[] } {
  const fresh: Bar[] = [];
  const revised: Bar[] = [];
  const adjChanged: Bar[] = [];

  for (const bar of bars) {
    const previous = existing.get(bar.barDate);
    if (!previous) {
      fresh.push(bar);
      continue;
    }

    if (
      !sameValue(previous.open, bar.open) ||
      !sameValue(previous.high, bar.high) ||
      !sameValue(previous.low, bar.low) ||
      !sameValue(previous.close, bar.close)
    ) {
      revised.push(bar);
      continue;
    }

    if (!sameValue(previous.adj_close, bar.adjClose)) {
      adjChanged.push(bar);
    }
  }

  return { fresh, revised, adjChanged };
}

function sameValue(stored: string, incoming: number): boolean {
  return Math.abs(Number(stored) - incoming) < 1e-8;
}

async function insertBars(
  client: PoolClient,
  instrumentId: number,
  provider: string,
  bars: Bar[],
): Promise<number> {
  let inserted = 0;

  for (let offset = 0; offset < bars.length; offset += CHUNK_SIZE) {
    const chunk = bars.slice(offset, offset + CHUNK_SIZE);
    const values: unknown[] = [];
    const placeholders: string[] = [];

    chunk.forEach((bar, index) => {
      const base = index * 8;
      placeholders.push(
        `($${base + 1}, '1d', $${base + 2}::date, $${base + 3}, $${base + 4}, ` +
          `$${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${chunk.length * 8 + 1})`,
      );
      values.push(
        instrumentId,
        bar.barDate,
        bar.open,
        bar.high,
        bar.low,
        bar.close,
        bar.adjClose,
        bar.volume,
      );
    });

    values.push(provider);

    const result = await client.query(
      `insert into ohlcv_bar
         (instrument_id, bar_interval, bar_date, open, high, low, close, adj_close, volume, provider)
       values ${placeholders.join(', ')}
       on conflict (instrument_id, bar_interval, bar_date) do nothing`,
      values,
    );

    inserted += result.rowCount ?? 0;
  }

  return inserted;
}

async function recordRepairs(
  client: PoolClient,
  instrumentId: number,
  repairs: BarRepair[],
): Promise<number> {
  for (const repair of repairs) {
    await client.query(
      `insert into resolution_anomaly
         (instrument_id, bar_interval, bar_date, field, stored_value, provider_value, note)
       values ($1, '1d', $2, $3, $4, $5, $6)`,
      [
        instrumentId,
        repair.barDate,
        repair.field,
        repair.storedValue,
        repair.providerValue,
        repair.note,
      ],
    );
  }
  return repairs.length;
}

export async function startIngestRun(provider: string): Promise<number> {
  const rows = await query<{ id: number }>(
    `insert into ingest_run (provider) values ($1) returning id`,
    [provider],
  );
  const id = rows[0]?.id;
  if (id === undefined) {
    throw new Error('no se pudo registrar el ingest_run');
  }
  return id;
}

export async function finishIngestRun(
  runId: number,
  status: 'ok' | 'partial' | 'failed',
  instrumentsCount: number,
  barsWritten: number,
  error: string | null,
): Promise<void> {
  await query(
    `update ingest_run
     set finished_at = now(), status = $2, instruments_count = $3,
         bars_written = $4, error = $5
     where id = $1`,
    [runId, status, instrumentsCount, barsWritten, error],
  );
}
