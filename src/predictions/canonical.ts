import { createHash } from 'node:crypto';
import { canonicalEventParams, eventKey } from './events.js';
import type { EventSpec, Horizon } from './events.js';

export const SCHEMA_VERSION = '1';
export const MIN_PROBABILITY = 0.001;
export const MAX_PROBABILITY = 0.999;

export type CanonicalValue = string | CanonicalObject;
export interface CanonicalObject {
  [key: string]: CanonicalValue;
}

export interface PredictionDraft {
  instrumentSymbol: string;
  modelKey: string;
  modelVersion: string;
  spec: EventSpec;
  horizon: Horizon;
  t0Utc: Date;
  windowEndUtc: Date;
  probability: number;
  origin: 'scheduled' | 'manual';
  featuresHash: string;
}

export interface CanonicalPrediction {
  payload: string;
  contentHash: string;
  eventKey: string;
  probabilityText: string;
}

export function canonicalJson(value: CanonicalValue): string {
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }

  const keys = Object.keys(value).sort();
  const parts = keys.map((key) => {
    const child = value[key];
    if (child === undefined) {
      throw new Error(`clave sin valor en el payload canonico: ${key}`);
    }
    return `${JSON.stringify(key)}:${canonicalJson(child)}`;
  });

  return `{${parts.join(',')}}`;
}

export function formatProbability(probability: number): string {
  if (!Number.isFinite(probability)) {
    throw new Error('probabilidad no finita');
  }
  if (probability < MIN_PROBABILITY || probability > MAX_PROBABILITY) {
    throw new Error(
      `probabilidad fuera de rango: ${probability} (permitido ${MIN_PROBABILITY}..${MAX_PROBABILITY})`,
    );
  }
  return probability.toFixed(5);
}

export function clampProbability(probability: number): number {
  if (!Number.isFinite(probability)) {
    throw new Error('probabilidad no finita');
  }
  return Math.min(MAX_PROBABILITY, Math.max(MIN_PROBABILITY, probability));
}

export function hashFeatures(bars: Array<{ barDate: string; adjClose: number }>): string {
  if (bars.length === 0) {
    throw new Error('no se puede hashear un conjunto de features vacio');
  }
  const serialized = bars
    .map((bar) => `${bar.barDate}:${bar.adjClose.toFixed(8)}`)
    .join('|');
  return sha256(serialized);
}

export function buildCanonicalPrediction(draft: PredictionDraft): CanonicalPrediction {
  const key = eventKey(draft.spec);
  const probabilityText = formatProbability(draft.probability);

  const payloadObject: CanonicalObject = {
    schemaVersion: SCHEMA_VERSION,
    instrumentSymbol: draft.instrumentSymbol,
    modelKey: draft.modelKey,
    modelVersion: draft.modelVersion,
    eventType: draft.spec.type,
    eventKey: key,
    eventParams: canonicalEventParams(draft.spec),
    horizon: draft.horizon,
    t0Utc: toIsoUtc(draft.t0Utc),
    windowEndUtc: toIsoUtc(draft.windowEndUtc),
    probability: probabilityText,
    origin: draft.origin,
    featuresHash: draft.featuresHash,
  };

  const payload = canonicalJson(payloadObject);

  return {
    payload,
    contentHash: sha256(payload),
    eventKey: key,
    probabilityText,
  };
}

export function toIsoUtc(date: Date): string {
  if (Number.isNaN(date.getTime())) {
    throw new Error('fecha invalida en el payload canonico');
  }
  return date.toISOString();
}

export function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}
