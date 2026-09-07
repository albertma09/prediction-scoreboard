import { describe, expect, it } from 'vitest';
import { normalizeBar } from './PriceProvider.js';
import type { Bar } from './PriceProvider.js';

function bar(overrides: Partial<Bar> = {}): Bar {
  return {
    barDate: '2026-01-15',
    open: 100,
    high: 110,
    low: 95,
    close: 105,
    adjClose: 105,
    volume: 1000,
    ...overrides,
  };
}

describe('normalizeBar', () => {
  it('deja intacta una barra coherente y no reporta reparaciones', () => {
    const result = normalizeBar(bar(), 'TEST');
    expect(result.repairs).toHaveLength(0);
    expect(result.bar).toEqual(bar());
  });

  it('repara un high por debajo de close dentro de tolerancia y lo registra', () => {
    const result = normalizeBar(bar({ high: 104.99, close: 105 }), 'TEST');
    expect(result.bar.high).toBe(105);
    expect(result.repairs).toHaveLength(1);
    expect(result.repairs[0]?.field).toBe('high');
    expect(result.repairs[0]?.providerValue).toBe(104.99);
    expect(result.repairs[0]?.storedValue).toBe(105);
  });

  it('repara un low por encima de open dentro de tolerancia', () => {
    const result = normalizeBar(bar({ low: 100.05, open: 100 }), 'TEST');
    expect(result.bar.low).toBe(100);
    expect(result.repairs[0]?.field).toBe('low');
  });

  it('rechaza un high muy por debajo de close', () => {
    expect(() => normalizeBar(bar({ high: 100, close: 105 }), 'TEST')).toThrow(
      /high=100 por debajo/,
    );
  });

  it('rechaza un low muy por encima de open', () => {
    expect(() => normalizeBar(bar({ low: 100, open: 90, close: 100 }), 'TEST')).toThrow(
      /low=100 por encima/,
    );
  });

  it('rechaza precios no positivos', () => {
    expect(() => normalizeBar(bar({ close: 0 }), 'TEST')).toThrow(/valor no positivo/);
    expect(() => normalizeBar(bar({ open: -1 }), 'TEST')).toThrow(/valor no positivo/);
  });

  it('rechaza valores no finitos', () => {
    expect(() => normalizeBar(bar({ close: Number.NaN }), 'TEST')).toThrow(
      /valor no positivo/,
    );
  });

  it('nunca modifica close ni adjClose', () => {
    const input = bar({ high: 104.99, low: 100.05, open: 100, close: 105, adjClose: 103 });
    const result = normalizeBar(input, 'TEST');
    expect(result.bar.close).toBe(105);
    expect(result.bar.adjClose).toBe(103);
  });
});
