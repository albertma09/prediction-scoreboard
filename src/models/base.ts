import type { AssetClass } from '../config/index.js';
import type { EventSpec, EventType, Horizon } from '../predictions/events.js';
import type { HistoryBar } from '../predictions/build.js';

export interface PredictContext {
  assetClass: AssetClass;
  horizon: Horizon;
  windowBars: number;
  spec: EventSpec;
  history: HistoryBar[];
}

export interface Model {
  readonly key: string;
  readonly version: string;
  readonly params: Record<string, number | string>;
  readonly isBaseline: boolean;
  supports(eventType: EventType): boolean;
  minimumHistory(windowBars: number): number;
  predict(ctx: PredictContext): number;
}

export function assertNoLookAhead(history: HistoryBar[], t0Date: string): void {
  for (const bar of history) {
    if (bar.barDate >= t0Date) {
      throw new Error(
        `fuga de informacion futura: la barra ${bar.barDate} no es anterior al slot ${t0Date}`,
      );
    }
  }
}

export function assertAscending(history: HistoryBar[]): void {
  for (let index = 1; index < history.length; index += 1) {
    const previous = history[index - 1];
    const current = history[index];
    if (previous === undefined || current === undefined) {
      throw new Error('historial con huecos');
    }
    if (current.barDate <= previous.barDate) {
      throw new Error(
        `historial no ordenado: ${current.barDate} no es posterior a ${previous.barDate}`,
      );
    }
  }
}
