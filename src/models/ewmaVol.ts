import { clampProbability } from '../predictions/canonical.js';
import { logReturns } from '../predictions/events.js';
import { chi2UpperTail, ewmaVariance, normalCdf } from '../util/stats.js';
import type { EventType } from '../predictions/events.js';
import type { Model, PredictContext } from './base.js';

export const LAMBDA = 0.94;

export const ewmaVolModel: Model = {
  key: 'ewmaVol',
  version: '1.0.0',
  params: { lambda: LAMBDA },
  isBaseline: false,

  supports(eventType: EventType): boolean {
    return eventType === 'MAG' || eventType === 'VOL';
  },

  minimumHistory(windowBars: number): number {
    return 60 + windowBars;
  },

  predict(ctx: PredictContext): number {
    const returns = logReturns(ctx.history.map((bar) => bar.adjClose));
    const dailyVariance = ewmaVariance(returns, LAMBDA);
    const dailySigma = Math.sqrt(dailyVariance);

    if (dailySigma <= 0) {
      throw new Error('volatilidad EWMA no positiva; historial degenerado');
    }

    const spec = ctx.spec;

    switch (spec.type) {
      case 'MAG':
        return clampProbability(
          magnitudeProbability(spec.params.thresholdAbs, dailySigma, ctx.windowBars),
        );
      case 'VOL':
        return clampProbability(
          volatilityProbability(spec.params.rvPrevious, dailySigma, ctx.windowBars),
        );
      case 'DIR':
        throw new Error('ewmaVol no emite predicciones de direccion');
    }
  },
};

export function magnitudeProbability(
  thresholdAbs: number,
  dailySigma: number,
  windowBars: number,
): number {
  if (thresholdAbs <= 0) {
    throw new Error('el umbral de magnitud debe ser positivo');
  }
  if (thresholdAbs >= 1) {
    throw new Error('un umbral de magnitud >= 100% no es representable en log-retornos');
  }

  const windowSigma = dailySigma * Math.sqrt(windowBars);
  const upperLogThreshold = Math.log(1 + thresholdAbs);
  const lowerLogThreshold = Math.log(1 - thresholdAbs);

  const upperTail = 1 - normalCdf(upperLogThreshold / windowSigma);
  const lowerTail = normalCdf(lowerLogThreshold / windowSigma);

  return upperTail + lowerTail;
}

export function volatilityProbability(
  rvPrevious: number,
  dailySigma: number,
  windowBars: number,
): number {
  if (rvPrevious <= 0) {
    return 0.999;
  }

  const statistic = (windowBars * rvPrevious * rvPrevious) / (dailySigma * dailySigma);
  return chi2UpperTail(statistic, windowBars);
}
