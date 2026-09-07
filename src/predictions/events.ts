import type { AssetClass } from '../config/index.js';

export type EventType = 'MAG' | 'VOL' | 'DIR';
export type Horizon = '1d' | '7d';

export interface MagParams {
  kSigma: number;
  sigmaWindow: number;
  thresholdAbs: number;
}

export interface VolParams {
  rvPrevious: number;
  windowBars: number;
}

export type EventSpec =
  | { type: 'MAG'; params: MagParams }
  | { type: 'VOL'; params: VolParams }
  | { type: 'DIR'; params: Record<string, never> };

export interface ResolutionInputs {
  baseAdjClose: number;
  endAdjClose: number;
  windowLogReturns: number[];
}

const CALENDAR_DAYS: Record<Horizon, number> = { '1d': 1, '7d': 7 };

const BARS_PER_WINDOW: Record<AssetClass, Record<Horizon, number>> = {
  crypto: { '1d': 1, '7d': 7 },
  equity: { '1d': 1, '7d': 5 },
  etf: { '1d': 1, '7d': 5 },
  index: { '1d': 1, '7d': 5 },
  fx: { '1d': 1, '7d': 5 },
};

export function calendarDaysFor(horizon: Horizon): number {
  return CALENDAR_DAYS[horizon];
}

export function barsPerWindow(assetClass: AssetClass, horizon: Horizon): number {
  return BARS_PER_WINDOW[assetClass][horizon];
}

export function logReturns(adjCloses: number[]): number[] {
  const returns: number[] = [];
  for (let index = 1; index < adjCloses.length; index += 1) {
    const previous = adjCloses[index - 1];
    const current = adjCloses[index];
    if (previous === undefined || current === undefined || previous <= 0 || current <= 0) {
      throw new Error('serie de precios invalida para calcular retornos');
    }
    returns.push(Math.log(current / previous));
  }
  return returns;
}

export function realizedVolatility(returns: number[]): number {
  if (returns.length === 0) {
    throw new Error('no se puede calcular volatilidad realizada sin retornos');
  }
  const sumOfSquares = returns.reduce((total, value) => total + value * value, 0);
  return Math.sqrt(sumOfSquares / returns.length);
}

export function simpleReturn(baseAdjClose: number, endAdjClose: number): number {
  if (baseAdjClose <= 0) {
    throw new Error('precio base no positivo');
  }
  return endAdjClose / baseAdjClose - 1;
}

export function eventKey(spec: EventSpec): string {
  switch (spec.type) {
    case 'MAG':
      return `MAG:k=${spec.params.kSigma.toFixed(1)},w=${spec.params.sigmaWindow}`;
    case 'VOL':
      return `VOL:b=${spec.params.windowBars}`;
    case 'DIR':
      return 'DIR:';
  }
}

export function eventLabel(spec: EventSpec, horizon: Horizon): string {
  switch (spec.type) {
    case 'MAG':
      return `movimiento absoluto >= ${(spec.params.thresholdAbs * 100).toFixed(2)}% en ${horizon}`;
    case 'VOL':
      return `volatilidad realizada de los proximos ${spec.params.windowBars} cierres por encima de ${(spec.params.rvPrevious * 100).toFixed(3)}%`;
    case 'DIR':
      return `retorno positivo en ${horizon}`;
  }
}

export function resolveEvent(spec: EventSpec, inputs: ResolutionInputs): 0 | 1 {
  switch (spec.type) {
    case 'MAG': {
      const move = Math.abs(simpleReturn(inputs.baseAdjClose, inputs.endAdjClose));
      return move >= spec.params.thresholdAbs ? 1 : 0;
    }
    case 'VOL': {
      const realized = realizedVolatility(inputs.windowLogReturns);
      return realized > spec.params.rvPrevious ? 1 : 0;
    }
    case 'DIR': {
      const move = simpleReturn(inputs.baseAdjClose, inputs.endAdjClose);
      return move > 0 ? 1 : 0;
    }
  }
}

export function canonicalEventParams(spec: EventSpec): Record<string, string> {
  switch (spec.type) {
    case 'MAG':
      return {
        kSigma: spec.params.kSigma.toFixed(1),
        sigmaWindow: String(spec.params.sigmaWindow),
        thresholdAbs: spec.params.thresholdAbs.toFixed(10),
      };
    case 'VOL':
      return {
        rvPrevious: spec.params.rvPrevious.toFixed(10),
        windowBars: String(spec.params.windowBars),
      };
    case 'DIR':
      return {};
  }
}
