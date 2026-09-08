import type { HistoryBar } from '../predictions/build.js';
import { logReturns } from '../predictions/events.js';
import { clampProbability } from '../predictions/canonical.js';
import { ewmaVarianceSeries } from '../util/stats.js';
import { volatilityProbability } from './ewmaVol.js';
import type { CalibrationPair } from './calibration.js';

export const MIN_MODEL_HISTORY_BARS = 60;

export interface VolatilityPairsOptions {
  history: readonly HistoryBar[];
  windowBars: number;
  lambda: number;
}

function at(values: readonly number[], index: number): number {
  const value = values[index];
  if (value === undefined) {
    throw new Error(`indice fuera de rango en la serie: ${index}`);
  }
  return value;
}

function windowRootMeanSquare(
  prefixSumSquares: readonly number[],
  from: number,
  to: number,
): number {
  const count = to - from + 1;
  if (count < 1) {
    throw new Error('ventana vacia al calcular volatilidad realizada');
  }
  const sumSquares = at(prefixSumSquares, to + 1) - at(prefixSumSquares, from);
  return Math.sqrt(Math.max(0, sumSquares) / count);
}

export function historicalVolatilityPairs(
  options: VolatilityPairsOptions,
): CalibrationPair[] {
  const { history, windowBars, lambda } = options;

  const closes = history.map((bar) => bar.adjClose);
  const barCount = closes.length;

  const firstPrefix = MIN_MODEL_HISTORY_BARS + windowBars;
  const lastPrefix = barCount - windowBars;

  if (barCount < 2 || lastPrefix < firstPrefix) {
    return [];
  }

  const returns = logReturns(closes);
  const variances = ewmaVarianceSeries(returns, lambda);

  const prefixSumSquares: number[] = new Array<number>(returns.length + 1).fill(0);
  for (let index = 0; index < returns.length; index += 1) {
    const value = at(returns, index);
    prefixSumSquares[index + 1] = at(prefixSumSquares, index) + value * value;
  }

  const pairs: CalibrationPair[] = [];

  for (let prefix = firstPrefix; prefix <= lastPrefix; prefix += 1) {
    const lastReturnIndex = prefix - 2;
    const dailySigma = Math.sqrt(at(variances, lastReturnIndex));
    if (!(dailySigma > 0)) {
      continue;
    }

    const rvPrevious = windowRootMeanSquare(
      prefixSumSquares,
      prefix - 1 - windowBars,
      lastReturnIndex,
    );
    const realized = windowRootMeanSquare(
      prefixSumSquares,
      prefix - 1,
      prefix + windowBars - 2,
    );

    pairs.push({
      probability: clampProbability(
        volatilityProbability(rvPrevious, dailySigma, windowBars),
      ),
      outcome: realized > rvPrevious ? 1 : 0,
    });
  }

  return pairs;
}
