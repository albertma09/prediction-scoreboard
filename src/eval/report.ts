import { query } from '../db/pool.js';
import { barsPerWindow } from '../predictions/events.js';
import type { Horizon } from '../predictions/events.js';
import {
  blockBootstrapSkillScore,
  calibrationBins,
  meanBrier,
  murphyDecomposition,
  pooledSkillScore,
} from './brier.js';
import type { CalibrationBin, PairedScore, ScoredPrediction } from './brier.js';
import type { AssetClass } from '../config/index.js';

export interface SliceKey {
  eventType: string;
  eventKey: string;
  horizon: Horizon;
  modelKey: string;
  symbol: string | null;
  assetClass: AssetClass | null;
}

export interface SliceReport extends SliceKey {
  count: number;
  baseRate: number;
  modelBrier: number;
  climatologyBrier: number | null;
  coinflipBrier: number;
  bssVsClimatology: number | null;
  bssVsCoinflip: number;
  bssVsCoinflipLower: number;
  bssVsCoinflipUpper: number;
  crossesZero: boolean;
  effectiveObservations: number;
  reliability: number;
  withinBinResidual: number;
  resolution: number;
  uncertainty: number;
}

interface ScoreRow {
  symbol: string;
  asset_class: AssetClass;
  horizon: string;
  event_type: string;
  event_key: string;
  model_key: string;
  t0_date: string;
  probability: string;
  outcome: number;
}

export async function loadBacktestScores(runId: number): Promise<ScoreRow[]> {
  return query<ScoreRow>(
    `select i.symbol, i.asset_class, b.horizon, b.event_type, b.event_key,
            b.model_key, b.t0_date::text as t0_date, b.probability::text, b.outcome
     from backtest_score b
     join instrument i on i.id = b.instrument_id
     where b.run_id = $1 and b.outcome is not null
     order by i.symbol, b.horizon, b.event_key, b.model_key, b.t0_date`,
    [runId],
  );
}

interface Observation {
  t0Date: string;
  probability: number;
  outcome: 0 | 1;
}

function groupKey(row: ScoreRow, perSymbol: boolean): string {
  const symbol = perSymbol ? row.symbol : '*';
  return [symbol, row.horizon, row.event_key, row.model_key].join('|');
}

export function buildSliceReports(
  rows: ScoreRow[],
  options: { perSymbol: boolean; bootstrapIterations?: number },
): SliceReport[] {
  const byModel = new Map<string, Map<string, Observation[]>>();
  const metadata = new Map<string, { row: ScoreRow }>();

  for (const row of rows) {
    const key = groupKey(row, options.perSymbol);
    let modelBuckets = byModel.get(key);
    if (!modelBuckets) {
      modelBuckets = new Map();
      byModel.set(key, modelBuckets);
      metadata.set(key, { row });
    }

    const bucket = modelBuckets.get(row.model_key) ?? [];
    bucket.push({
      t0Date: row.t0_date,
      probability: Number(row.probability),
      outcome: row.outcome === 1 ? 1 : 0,
    });
    modelBuckets.set(row.model_key, bucket);
  }

  const grouped = new Map<string, Map<string, Observation[]>>();
  for (const [key, modelBuckets] of byModel) {
    const stripped = key.split('|');
    const withoutModel = stripped.slice(0, 3).join('|');
    const target = grouped.get(withoutModel) ?? new Map<string, Observation[]>();
    for (const [modelKey, observations] of modelBuckets) {
      target.set(modelKey, observations);
    }
    grouped.set(withoutModel, target);
    metadata.set(withoutModel, metadata.get(key) ?? { row: rows[0]! });
  }

  const reports: SliceReport[] = [];

  for (const [key, modelBuckets] of grouped) {
    const meta = metadata.get(key);
    if (!meta) {
      continue;
    }

    const coinflip = modelBuckets.get('coinflip');
    const climatology = modelBuckets.get('climatology');
    if (!coinflip) {
      continue;
    }

    for (const [modelKey, observations] of modelBuckets) {
      const paired = pairObservations(observations, coinflip);
      if (paired.length === 0) {
        continue;
      }

      const scored: ScoredPrediction[] = observations.map((item) => ({
        probability: item.probability,
        outcome: item.outcome,
      }));

      const windowBars = barsPerWindow(
        meta.row.asset_class,
        meta.row.horizon === '1d' ? '1d' : '7d',
      );

      const interval = blockBootstrapSkillScore(paired, {
        blockSize: windowBars,
        iterations: options.bootstrapIterations ?? 1000,
        seed: 20260907,
      });

      const climatologyPaired = climatology
        ? pairObservations(observations, climatology)
        : null;

      const murphy = murphyDecomposition(scored);

      reports.push({
        symbol: options.perSymbol ? meta.row.symbol : null,
        assetClass: options.perSymbol ? meta.row.asset_class : null,
        horizon: meta.row.horizon === '1d' ? '1d' : '7d',
        eventType: meta.row.event_type,
        eventKey: meta.row.event_key,
        modelKey,
        count: observations.length,
        baseRate: observations.reduce((sum, item) => sum + item.outcome, 0) / observations.length,
        modelBrier: meanBrier(scored),
        climatologyBrier: climatology
          ? meanBrier(
              climatology.map((item) => ({
                probability: item.probability,
                outcome: item.outcome,
              })),
            )
          : null,
        coinflipBrier: meanBrier(
          coinflip.map((item) => ({ probability: item.probability, outcome: item.outcome })),
        ),
        bssVsClimatology:
          climatologyPaired && climatologyPaired.length > 0
            ? pooledSkillScore(climatologyPaired)
            : null,
        bssVsCoinflip: interval.point,
        bssVsCoinflipLower: interval.lower,
        bssVsCoinflipUpper: interval.upper,
        crossesZero: interval.lower <= 0 && interval.upper >= 0,
        effectiveObservations: Math.round(observations.length / windowBars),
        reliability: murphy.reliability,
        withinBinResidual: murphy.withinBinResidual,
        resolution: murphy.resolution,
        uncertainty: murphy.uncertainty,
      });
    }
  }

  return reports.sort(
    (a, b) =>
      a.horizon.localeCompare(b.horizon) ||
      a.eventKey.localeCompare(b.eventKey) ||
      a.modelKey.localeCompare(b.modelKey),
  );
}

function pairObservations(
  model: Observation[],
  baseline: Observation[],
): PairedScore[] {
  const baselineByDate = new Map(baseline.map((item) => [item.t0Date, item]));
  const paired: PairedScore[] = [];

  for (const item of model) {
    const counterpart = baselineByDate.get(item.t0Date);
    if (!counterpart) {
      continue;
    }
    paired.push({
      modelProbability: item.probability,
      baselineProbability: counterpart.probability,
      outcome: item.outcome,
    });
  }

  return paired;
}

export const CALIBRATION_EVENT_TYPES = ['MAG', 'VOL', 'DIR'] as const;

export function calibrationFor(
  rows: ScoreRow[],
  modelKey: string,
  binCount = 10,
  eventType?: string,
): CalibrationBin[] {
  const items: ScoredPrediction[] = rows
    .filter(
      (row) =>
        row.model_key === modelKey &&
        (eventType === undefined || row.event_type === eventType),
    )
    .map((row) => ({
      probability: Number(row.probability),
      outcome: row.outcome === 1 ? 1 : 0,
    }));

  if (items.length === 0) {
    return [];
  }

  return calibrationBins(items, binCount);
}

export function calibrationByEvent(
  rows: ScoreRow[],
  modelKey: string,
  binCount = 10,
): Record<string, CalibrationBin[]> {
  const byEvent: Record<string, CalibrationBin[]> = {};

  for (const eventType of CALIBRATION_EVENT_TYPES) {
    const bins = calibrationFor(rows, modelKey, binCount, eventType);
    if (bins.length > 0) {
      byEvent[eventType] = bins;
    }
  }

  return byEvent;
}
