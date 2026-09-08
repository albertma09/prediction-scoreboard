import { clampProbability } from '../predictions/canonical.js';

export const MIN_CALIBRATION_PAIRS = 120;
export const SLOPE_LOW = 0.2;
export const SLOPE_HIGH = 1.5;
export const SLOPE_SEARCH_ITERATIONS = 24;
export const NEUTRAL_SLOPE = 1;

const LOGIT_CLAMP = 1e-6;

export interface CalibrationPair {
  probability: number;
  outcome: 0 | 1;
}

export function logit(probability: number): number {
  const bounded = Math.min(1 - LOGIT_CLAMP, Math.max(LOGIT_CLAMP, probability));
  return Math.log(bounded / (1 - bounded));
}

export function sigmoid(z: number): number {
  if (z >= 0) {
    return 1 / (1 + Math.exp(-z));
  }
  const exponential = Math.exp(z);
  return exponential / (1 + exponential);
}

export function applySlope(probability: number, slope: number): number {
  return clampProbability(sigmoid(slope * logit(probability)));
}

function meanBrierAtSlope(
  logits: readonly number[],
  outcomes: readonly (0 | 1)[],
  slope: number,
): number {
  let total = 0;

  for (let index = 0; index < logits.length; index += 1) {
    const rawLogit = logits[index];
    const outcome = outcomes[index];
    if (rawLogit === undefined || outcome === undefined) {
      throw new Error('pares de calibracion incompletos');
    }
    const error = clampProbability(sigmoid(slope * rawLogit)) - outcome;
    total += error * error;
  }

  return total / logits.length;
}

export function fitSlope(pairs: readonly CalibrationPair[]): number {
  if (pairs.length < MIN_CALIBRATION_PAIRS) {
    return NEUTRAL_SLOPE;
  }

  const logits = pairs.map((pair) => logit(pair.probability));
  const outcomes = pairs.map((pair) => pair.outcome);

  let low = SLOPE_LOW;
  let high = SLOPE_HIGH;

  for (let iteration = 0; iteration < SLOPE_SEARCH_ITERATIONS; iteration += 1) {
    const third = (high - low) / 3;
    const candidateLow = low + third;
    const candidateHigh = high - third;

    if (
      meanBrierAtSlope(logits, outcomes, candidateLow) <=
      meanBrierAtSlope(logits, outcomes, candidateHigh)
    ) {
      high = candidateHigh;
    } else {
      low = candidateLow;
    }
  }

  return (low + high) / 2;
}
