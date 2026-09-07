import { clampProbability } from '../predictions/canonical.js';
import { logReturns, realizedVolatility } from '../predictions/events.js';
import type { Model, PredictContext } from './base.js';

export const climatologyModel: Model = {
  key: 'climatology',
  version: '1.0.0',
  params: {},
  isBaseline: true,

  supports(): boolean {
    return true;
  },

  minimumHistory(windowBars: number): number {
    return 2 * windowBars + 30;
  },

  predict(ctx: PredictContext): number {
    const closes = ctx.history.map((bar) => bar.adjClose);
    const window = ctx.windowBars;
    const spec = ctx.spec;

    switch (spec.type) {
      case 'MAG': {
        const threshold = spec.params.thresholdAbs;
        return clampProbability(
          frequencyOf(closes, window, (move) => Math.abs(move) >= threshold),
        );
      }
      case 'DIR':
        return clampProbability(frequencyOf(closes, window, (move) => move > 0));
      case 'VOL':
        return clampProbability(volatilityIncreaseFrequency(closes, window));
    }
  },
};

function frequencyOf(
  closes: number[],
  window: number,
  matches: (move: number) => boolean,
): number {
  let observations = 0;
  let hits = 0;

  for (let index = 0; index + window < closes.length; index += 1) {
    const base = closes[index];
    const end = closes[index + window];
    if (base === undefined || end === undefined || base <= 0) {
      continue;
    }
    observations += 1;
    if (matches(end / base - 1)) {
      hits += 1;
    }
  }

  if (observations === 0) {
    throw new Error('historial insuficiente para estimar la tasa base');
  }

  return hits / observations;
}

function volatilityIncreaseFrequency(closes: number[], window: number): number {
  const returns = logReturns(closes);
  let observations = 0;
  let hits = 0;

  for (let start = window; start + window <= returns.length; start += 1) {
    const previous = returns.slice(start - window, start);
    const current = returns.slice(start, start + window);
    observations += 1;
    if (realizedVolatility(current) > realizedVolatility(previous)) {
      hits += 1;
    }
  }

  if (observations === 0) {
    throw new Error('historial insuficiente para estimar la tasa base de volatilidad');
  }

  return hits / observations;
}
