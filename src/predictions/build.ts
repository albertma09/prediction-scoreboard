import type { AssetClass } from '../config/index.js';
import { sampleStdev } from '../util/stats.js';
import {
  barsPerWindow,
  logReturns,
  realizedVolatility,
} from './events.js';
import type { EventSpec, Horizon } from './events.js';

export const SIGMA_WINDOW = 30;
export const MAG_K_VALUES = [1.0, 1.5] as const;

export interface HistoryBar {
  barDate: string;
  adjClose: number;
}

export interface EventBuildContext {
  assetClass: AssetClass;
  horizon: Horizon;
  history: HistoryBar[];
}

export function minimumHistoryBars(horizon: Horizon, assetClass: AssetClass): number {
  return SIGMA_WINDOW + 2 * barsPerWindow(assetClass, horizon) + 1;
}

export function buildEventSpecs(ctx: EventBuildContext): EventSpec[] {
  const required = minimumHistoryBars(ctx.horizon, ctx.assetClass);
  if (ctx.history.length < required) {
    throw new Error(
      `historial insuficiente: ${ctx.history.length} barras, se necesitan ${required}`,
    );
  }

  const closes = ctx.history.map((bar) => bar.adjClose);
  const allReturns = logReturns(closes);
  const window = barsPerWindow(ctx.assetClass, ctx.horizon);

  const sigmaDaily = sampleStdev(allReturns.slice(-SIGMA_WINDOW));
  const sigmaWindow = sigmaDaily * Math.sqrt(window);

  const previousWindowReturns = allReturns.slice(-window);
  const rvPrevious = realizedVolatility(previousWindowReturns);

  const specs: EventSpec[] = MAG_K_VALUES.map((kSigma) => ({
    type: 'MAG' as const,
    params: {
      kSigma,
      sigmaWindow: SIGMA_WINDOW,
      thresholdAbs: kSigma * sigmaWindow,
    },
  }));

  specs.push({ type: 'VOL', params: { rvPrevious, windowBars: window } });
  specs.push({ type: 'DIR', params: {} });

  return specs;
}

export function sigmaDailyFrom(history: HistoryBar[]): number {
  const returns = logReturns(history.map((bar) => bar.adjClose));
  return sampleStdev(returns.slice(-SIGMA_WINDOW));
}
