import { describe, expect, it } from 'vitest';
import {
  barsPerWindow,
  eventKey,
  logReturns,
  realizedVolatility,
  resolveEvent,
  simpleReturn,
} from './events.js';
import type { EventSpec } from './events.js';

describe('logReturns', () => {
  it('calcula el log retorno entre cierres consecutivos', () => {
    const returns = logReturns([100, 110, 99]);
    expect(returns).toHaveLength(2);
    expect(returns[0]).toBeCloseTo(Math.log(1.1), 12);
    expect(returns[1]).toBeCloseTo(Math.log(0.9), 12);
  });

  it('rechaza precios no positivos', () => {
    expect(() => logReturns([100, 0])).toThrow(/invalida/);
    expect(() => logReturns([-1, 100])).toThrow(/invalida/);
  });
});

describe('realizedVolatility', () => {
  it('con un solo retorno devuelve su valor absoluto', () => {
    expect(realizedVolatility([-0.03])).toBeCloseTo(0.03, 12);
  });

  it('es la raiz de la media de cuadrados', () => {
    expect(realizedVolatility([0.03, -0.04])).toBeCloseTo(Math.sqrt((0.0009 + 0.0016) / 2), 12);
  });

  it('rechaza una ventana vacia', () => {
    expect(() => realizedVolatility([])).toThrow(/sin retornos/);
  });
});

describe('barsPerWindow', () => {
  it('cripto tiene 7 cierres en una semana y bolsa 5', () => {
    expect(barsPerWindow('crypto', '7d')).toBe(7);
    expect(barsPerWindow('equity', '7d')).toBe(5);
    expect(barsPerWindow('etf', '7d')).toBe(5);
    expect(barsPerWindow('crypto', '1d')).toBe(1);
  });
});

describe('eventKey', () => {
  it('genera claves estables y legibles', () => {
    expect(
      eventKey({ type: 'MAG', params: { kSigma: 1, sigmaWindow: 30, thresholdAbs: 0.05 } }),
    ).toBe('MAG:k=1.0,w=30');
    expect(eventKey({ type: 'VOL', params: { rvPrevious: 0.02, windowBars: 7 } })).toBe(
      'VOL:b=7',
    );
    expect(eventKey({ type: 'DIR', params: {} })).toBe('DIR:');
  });
});

describe('resolveEvent MAG', () => {
  const spec: EventSpec = {
    type: 'MAG',
    params: { kSigma: 1.5, sigmaWindow: 30, thresholdAbs: 0.05 },
  };

  it('acierta cuando la subida supera el umbral', () => {
    expect(resolveEvent(spec, { baseAdjClose: 100, endAdjClose: 106, windowLogReturns: [0.05] })).toBe(1);
  });

  it('acierta cuando la bajada supera el umbral en valor absoluto', () => {
    expect(resolveEvent(spec, { baseAdjClose: 100, endAdjClose: 94, windowLogReturns: [-0.06] })).toBe(1);
  });

  it('no acierta cuando el movimiento queda por debajo', () => {
    expect(resolveEvent(spec, { baseAdjClose: 100, endAdjClose: 104, windowLogReturns: [0.04] })).toBe(0);
  });

  it('el umbral es inclusivo justo en el limite', () => {
    expect(resolveEvent(spec, { baseAdjClose: 100, endAdjClose: 105, windowLogReturns: [0.05] })).toBe(1);
  });

  it('usa el umbral congelado y no recalcula sigma', () => {
    const wide: EventSpec = {
      type: 'MAG',
      params: { kSigma: 1.5, sigmaWindow: 30, thresholdAbs: 0.5 },
    };
    expect(resolveEvent(wide, { baseAdjClose: 100, endAdjClose: 106, windowLogReturns: [0.05] })).toBe(0);
  });
});

describe('resolveEvent VOL', () => {
  const spec: EventSpec = { type: 'VOL', params: { rvPrevious: 0.02, windowBars: 7 } };

  it('acierta cuando la volatilidad realizada supera la previa', () => {
    expect(
      resolveEvent(spec, { baseAdjClose: 100, endAdjClose: 100, windowLogReturns: [0.03, -0.03] }),
    ).toBe(1);
  });

  it('no acierta cuando queda por debajo', () => {
    expect(
      resolveEvent(spec, { baseAdjClose: 100, endAdjClose: 100, windowLogReturns: [0.01, -0.01] }),
    ).toBe(0);
  });

  it('el empate exacto cuenta como no ocurrido', () => {
    expect(
      resolveEvent(spec, { baseAdjClose: 100, endAdjClose: 100, windowLogReturns: [0.02] }),
    ).toBe(0);
  });
});

describe('resolveEvent DIR', () => {
  const spec: EventSpec = { type: 'DIR', params: {} };

  it('acierta con retorno positivo', () => {
    expect(resolveEvent(spec, { baseAdjClose: 100, endAdjClose: 101, windowLogReturns: [0.01] })).toBe(1);
  });

  it('no acierta con retorno negativo', () => {
    expect(resolveEvent(spec, { baseAdjClose: 100, endAdjClose: 99, windowLogReturns: [-0.01] })).toBe(0);
  });

  it('el precio plano cuenta como no ocurrido', () => {
    expect(resolveEvent(spec, { baseAdjClose: 100, endAdjClose: 100, windowLogReturns: [0] })).toBe(0);
  });
});

describe('simpleReturn', () => {
  it('rechaza un precio base no positivo', () => {
    expect(() => simpleReturn(0, 100)).toThrow(/no positivo/);
  });
});
