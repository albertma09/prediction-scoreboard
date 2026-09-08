import { logReturns } from '../predictions/events.js';
import type { EventType } from '../predictions/events.js';
import { clampProbability } from '../predictions/canonical.js';
import { ewmaVariance } from '../util/stats.js';
import { LAMBDA, volatilityProbability } from './ewmaVol.js';
import {
  applySlope,
  fitSlope,
  MIN_CALIBRATION_PAIRS,
  SLOPE_HIGH,
  SLOPE_LOW,
  SLOPE_SEARCH_ITERATIONS,
} from './calibration.js';
import { historicalVolatilityPairs, MIN_MODEL_HISTORY_BARS } from './volPairs.js';
import type { Model, PredictContext } from './base.js';

export const volCalModel: Model = {
  key: 'volCal',
  version: '1.0.0',
  params: {
    lambda: LAMBDA,
    minPairs: MIN_CALIBRATION_PAIRS,
    slopeLow: SLOPE_LOW,
    slopeHigh: SLOPE_HIGH,
    slopeIterations: SLOPE_SEARCH_ITERATIONS,
  },
  isBaseline: false,

  supports(eventType: EventType): boolean {
    return eventType === 'VOL';
  },

  minimumHistory(windowBars: number): number {
    return MIN_MODEL_HISTORY_BARS + windowBars;
  },

  predict(ctx: PredictContext): number {
    const spec = ctx.spec;
    if (spec.type !== 'VOL') {
      throw new Error('volCal solo emite predicciones de volatilidad');
    }

    const returns = logReturns(ctx.history.map((bar) => bar.adjClose));
    const dailySigma = Math.sqrt(ewmaVariance(returns, LAMBDA));
    if (!(dailySigma > 0)) {
      throw new Error('volatilidad EWMA no positiva; historial degenerado');
    }

    const raw = clampProbability(
      volatilityProbability(spec.params.rvPrevious, dailySigma, ctx.windowBars),
    );

    const pairs = historicalVolatilityPairs({
      history: ctx.history,
      windowBars: ctx.windowBars,
      lambda: LAMBDA,
    });

    return applySlope(raw, fitSlope(pairs));
  },
};
