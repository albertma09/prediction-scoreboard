import type { AssetClass } from '../config/index.js';

export type BarInterval = '1d';

export interface Bar {
  barDate: string;
  open: number;
  high: number;
  low: number;
  close: number;
  adjClose: number;
  volume: number | null;
}

export interface BarRepair {
  barDate: string;
  field: 'high' | 'low';
  storedValue: number;
  providerValue: number;
  note: string;
}

export interface NormalizedBars {
  bars: Bar[];
  repairs: BarRepair[];
}

export interface InstrumentHit {
  providerSymbol: string;
  name: string;
  assetClass: AssetClass;
  exchange: string | null;
  currency: string;
}

export interface PriceProvider {
  readonly key: string;
  readonly supportsSearch: boolean;
  fetchBars(
    providerSymbol: string,
    interval: BarInterval,
    fromDate: string,
    toDate: string,
  ): Promise<NormalizedBars>;
  searchSymbols(query: string): Promise<InstrumentHit[]>;
}

const RANGE_TOLERANCE = 1e-3;

export function normalizeBar(
  raw: Bar,
  providerSymbol: string,
): { bar: Bar; repairs: BarRepair[] } {
  const values = [raw.open, raw.high, raw.low, raw.close, raw.adjClose];
  if (values.some((value) => !Number.isFinite(value) || value <= 0)) {
    throw new Error(`barra invalida en ${providerSymbol} ${raw.barDate}: valor no positivo`);
  }

  const repairs: BarRepair[] = [];
  let high = raw.high;
  let low = raw.low;

  const observedHigh = Math.max(raw.open, raw.close);
  const observedLow = Math.min(raw.open, raw.close);

  if (observedHigh > high) {
    const breach = (observedHigh - high) / observedHigh;
    if (breach > RANGE_TOLERANCE) {
      throw new Error(
        `barra invalida en ${providerSymbol} ${raw.barDate}: ` +
          `high=${high} por debajo de open/close=${observedHigh} (${(breach * 100).toFixed(4)}%)`,
      );
    }
    repairs.push({
      barDate: raw.barDate,
      field: 'high',
      storedValue: observedHigh,
      providerValue: high,
      note: `high del proveedor por debajo de open/close, desviacion relativa ${breach.toExponential(2)}`,
    });
    high = observedHigh;
  }

  if (observedLow < low) {
    const breach = (low - observedLow) / observedLow;
    if (breach > RANGE_TOLERANCE) {
      throw new Error(
        `barra invalida en ${providerSymbol} ${raw.barDate}: ` +
          `low=${low} por encima de open/close=${observedLow} (${(breach * 100).toFixed(4)}%)`,
      );
    }
    repairs.push({
      barDate: raw.barDate,
      field: 'low',
      storedValue: observedLow,
      providerValue: low,
      note: `low del proveedor por encima de open/close, desviacion relativa ${breach.toExponential(2)}`,
    });
    low = observedLow;
  }

  if (high < low) {
    throw new Error(`barra invalida en ${providerSymbol} ${raw.barDate}: high < low`);
  }

  return { bar: { ...raw, high, low }, repairs };
}
