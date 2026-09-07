import type { AssetClass } from '../config/index.js';
import {
  barsPerWindow,
  logReturns,
  realizedVolatility,
  resolveEvent,
} from '../predictions/events.js';
import type { EventSpec, Horizon, ResolutionInputs } from '../predictions/events.js';

export type VoidReason = 'no_bars_in_window' | 'insufficient_vol_bars' | 'no_base_bar';

export interface WindowBar {
  barDate: string;
  adjClose: number;
}

export interface ResolutionAttempt {
  outcome: 0 | 1 | null;
  voidReason: VoidReason | null;
  inputs: {
    baseBar: WindowBar | null;
    endBar: WindowBar | null;
    windowBars: WindowBar[];
    windowLogReturns: number[];
    realizedVolatility: number | null;
    simpleReturn: number | null;
  };
}

export function minimumVolBars(assetClass: AssetClass, horizon: Horizon): number {
  return Math.max(1, Math.ceil(0.6 * barsPerWindow(assetClass, horizon)));
}

export function selectWindow(
  bars: readonly WindowBar[],
  t0Date: string,
  windowEndDate: string,
): { baseBar: WindowBar | null; windowBars: WindowBar[] } {
  let baseBar: WindowBar | null = null;
  const windowBars: WindowBar[] = [];

  for (const bar of bars) {
    if (bar.barDate < t0Date) {
      baseBar = bar;
      continue;
    }
    if (bar.barDate < windowEndDate) {
      windowBars.push(bar);
    }
  }

  return { baseBar, windowBars };
}

export function attemptResolution(
  spec: EventSpec,
  assetClass: AssetClass,
  horizon: Horizon,
  bars: readonly WindowBar[],
  t0Date: string,
  windowEndDate: string,
): ResolutionAttempt {
  const { baseBar, windowBars } = selectWindow(bars, t0Date, windowEndDate);

  const emptyInputs = {
    baseBar,
    endBar: null,
    windowBars,
    windowLogReturns: [],
    realizedVolatility: null,
    simpleReturn: null,
  };

  if (!baseBar) {
    return { outcome: null, voidReason: 'no_base_bar', inputs: emptyInputs };
  }

  if (windowBars.length === 0) {
    return { outcome: null, voidReason: 'no_bars_in_window', inputs: emptyInputs };
  }

  if (spec.type === 'VOL' && windowBars.length < minimumVolBars(assetClass, horizon)) {
    return { outcome: null, voidReason: 'insufficient_vol_bars', inputs: emptyInputs };
  }

  const endBar = windowBars[windowBars.length - 1];
  if (!endBar) {
    return { outcome: null, voidReason: 'no_bars_in_window', inputs: emptyInputs };
  }

  const closes = [baseBar.adjClose, ...windowBars.map((bar) => bar.adjClose)];
  const windowLogReturns = logReturns(closes);

  const inputs: ResolutionInputs = {
    baseAdjClose: baseBar.adjClose,
    endAdjClose: endBar.adjClose,
    windowLogReturns,
  };

  const outcome = resolveEvent(spec, inputs);

  return {
    outcome,
    voidReason: null,
    inputs: {
      baseBar,
      endBar,
      windowBars,
      windowLogReturns,
      realizedVolatility: realizedVolatility(windowLogReturns),
      simpleReturn: endBar.adjClose / baseBar.adjClose - 1,
    },
  };
}
