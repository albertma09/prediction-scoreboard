import { query } from '../db/pool.js';
import { listTrackedInstruments } from '../instruments/catalog.js';
import type { InstrumentRow } from '../instruments/catalog.js';
import { buildEventSpecs, minimumHistoryBars } from '../predictions/build.js';
import type { HistoryBar } from '../predictions/build.js';
import { barsPerWindow, calendarDaysFor } from '../predictions/events.js';
import type { Horizon } from '../predictions/events.js';
import { clampProbability, hashFeatures } from '../predictions/canonical.js';
import { allModels, registerAllModels } from '../models/registry.js';
import { assertAscending, assertNoLookAhead } from '../models/base.js';
import { append, EMISSION_TOLERANCE_MS, LedgerRejection } from '../ledger/ledger.js';
import { addDaysUtc } from '../util/dates.js';
import { currentSlotUtc, minutesLate, slotDateOf, windowCanHaveSession } from './session.js';

const HORIZONS: Horizon[] = ['1d', '7d'];
const DUPLICATE_CONSTRAINTS = new Set([
  'prediction_unique_emission',
  'prediction_content_hash_key',
  'prediction_chain_hash_key',
]);

export interface EmissionReport {
  runId: number;
  slotDate: string;
  status: 'ok' | 'partial' | 'skipped_late' | 'failed';
  emitted: number;
  alreadyPresent: number;
  skippedNoSession: number;
  skippedNoHistory: number;
  minutesLate: number;
  notes: string[];
}

async function loadHistory(instrumentId: number, beforeDate: string): Promise<HistoryBar[]> {
  const rows = await query<{ bar_date: string; adj_close: string }>(
    `select bar_date::text as bar_date, adj_close::text
     from ohlcv_bar
     where instrument_id = $1 and bar_interval = '1d' and bar_date < $2::date
     order by bar_date asc`,
    [instrumentId, beforeDate],
  );
  return rows.map((row) => ({ barDate: row.bar_date, adjClose: Number(row.adj_close) }));
}

async function openRun(slotDate: string): Promise<number> {
  const rows = await query<{ id: number }>(
    `insert into emission_run (slot_date) values ($1::date)
     on conflict (slot_date) do update set started_at = now(), status = 'running'
     returning id`,
    [slotDate],
  );
  const id = rows[0]?.id;
  if (id === undefined) {
    throw new Error('no se pudo abrir el emission_run');
  }
  return id;
}

async function closeRun(runId: number, report: Omit<EmissionReport, 'runId'>): Promise<void> {
  await query(
    `update emission_run
     set finished_at = now(), status = $2, emitted = $3, already_present = $4,
         skipped_no_session = $5, skipped_no_history = $6, minutes_late = $7, error = $8
     where id = $1`,
    [
      runId,
      report.status,
      report.emitted,
      report.alreadyPresent,
      report.skippedNoSession,
      report.skippedNoHistory,
      report.minutesLate,
      report.notes.length > 0 ? report.notes.join(' | ').slice(0, 2000) : null,
    ],
  );
}

function isDuplicate(error: unknown): boolean {
  if (error === null || typeof error !== 'object') {
    return false;
  }
  const constraint = (error as { constraint?: unknown }).constraint;
  return typeof constraint === 'string' && DUPLICATE_CONSTRAINTS.has(constraint);
}

export interface EmitOptions {
  allowLateEmissionMs?: number;
  allowClosedWindow?: boolean;
}

export async function emitForSlot(
  now = Date.now(),
  options: EmitOptions = {},
): Promise<EmissionReport> {
  const slot = currentSlotUtc(now);
  const slotDate = slotDateOf(slot);
  const late = minutesLate(slot, now);
  const runId = await openRun(slotDate);

  const report: Omit<EmissionReport, 'runId'> = {
    slotDate,
    status: 'ok',
    emitted: 0,
    alreadyPresent: 0,
    skippedNoSession: 0,
    skippedNoHistory: 0,
    minutesLate: late,
    notes: [],
  };

  const tolerance = options.allowLateEmissionMs ?? EMISSION_TOLERANCE_MS;
  if (now - slot.getTime() > tolerance) {
    report.status = 'skipped_late';
    report.notes.push(
      `el slot se abrio hace ${late} minutos y la tolerancia es ` +
        `${Math.round(tolerance / 60_000)}; no se emite nada para no ver parte del movimiento`,
    );
    await closeRun(runId, report);
    return { runId, ...report };
  }

  const modelIds = await registerAllModels();
  const models = allModels();
  const instruments = await listTrackedInstruments();
  let failures = 0;

  for (const instrument of instruments) {
    for (const horizon of HORIZONS) {
      const outcome = await emitOne(
        instrument,
        horizon,
        slot,
        slotDate,
        models,
        modelIds,
        report,
        options,
      );
      if (outcome === 'failed') {
        failures += 1;
      }
    }
  }

  if (failures > 0) {
    report.status = report.emitted > 0 ? 'partial' : 'failed';
  }

  await closeRun(runId, report);
  return { runId, ...report };
}

async function emitOne(
  instrument: InstrumentRow,
  horizon: Horizon,
  slot: Date,
  slotDate: string,
  models: ReturnType<typeof allModels>,
  modelIds: Map<string, number>,
  report: Omit<EmissionReport, 'runId'>,
  options: EmitOptions,
): Promise<'ok' | 'skipped' | 'failed'> {
  if (!windowCanHaveSession(instrument.asset_class, slotDate, horizon)) {
    report.skippedNoSession += 1;
    return 'skipped';
  }

  const windowBars = barsPerWindow(instrument.asset_class, horizon);
  const required = Math.max(
    minimumHistoryBars(horizon, instrument.asset_class),
    ...models.map((model) => model.minimumHistory(windowBars)),
  );

  const history = await loadHistory(instrument.id, slotDate);

  if (history.length < required) {
    report.skippedNoHistory += 1;
    report.notes.push(
      `${instrument.symbol} ${horizon}: historial insuficiente (${history.length}/${required})`,
    );
    return 'skipped';
  }

  assertAscending(history);
  assertNoLookAhead(history, slotDate);

  const specs = buildEventSpecs({
    assetClass: instrument.asset_class,
    horizon,
    history,
  });

  const featuresHash = hashFeatures(history.slice(-120));
  const windowEnd = new Date(`${addDaysUtc(slotDate, calendarDaysFor(horizon))}T00:00:00.000Z`);

  for (const spec of specs) {
    for (const model of models) {
      if (!model.supports(spec.type)) {
        continue;
      }

      const modelVersionId = modelIds.get(model.key);
      if (modelVersionId === undefined) {
        report.notes.push(`${model.key}: sin id de version registrada`);
        return 'failed';
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

        await append({
          instrumentId: instrument.id,
          modelVersionId,
          ...(options.allowLateEmissionMs === undefined
            ? {}
            : { allowLateEmissionMs: options.allowLateEmissionMs }),
          ...(options.allowClosedWindow === undefined
            ? {}
            : { allowClosedWindow: options.allowClosedWindow }),
          draft: {
            instrumentSymbol: instrument.symbol,
            modelKey: model.key,
            modelVersion: model.version,
            spec,
            horizon,
            t0Utc: slot,
            windowEndUtc: windowEnd,
            probability,
            origin: 'scheduled',
            featuresHash,
          },
        });

        report.emitted += 1;
      } catch (error) {
        if (isDuplicate(error)) {
          report.alreadyPresent += 1;
          continue;
        }
        if (error instanceof LedgerRejection) {
          report.notes.push(`${instrument.symbol} ${horizon}: ${error.message.slice(0, 160)}`);
          return 'failed';
        }
        report.notes.push(
          `${instrument.symbol} ${horizon} ${model.key}: ` +
            (error instanceof Error ? error.message.slice(0, 160) : 'error desconocido'),
        );
        return 'failed';
      }
    }
  }

  return 'ok';
}

export async function emissionHistory(days = 30): Promise<
  Array<{
    slotDate: string;
    status: string;
    emitted: number;
    minutesLate: number | null;
  }>
> {
  const rows = await query<{
    slot_date: string;
    status: string;
    emitted: number;
    minutes_late: number | null;
  }>(
    `select slot_date::text as slot_date, status, emitted, minutes_late
     from emission_run
     order by slot_date desc
     limit $1`,
    [days],
  );

  return rows.map((row) => ({
    slotDate: row.slot_date,
    status: row.status,
    emitted: row.emitted,
    minutesLate: row.minutes_late,
  }));
}
