import { describe, expect, it } from 'vitest';
import { buildEventSpecs, minimumHistoryBars, SIGMA_WINDOW } from '../predictions/build.js';
import { barsPerWindow, realizedVolatility, logReturns } from '../predictions/events.js';
import type { EventSpec } from '../predictions/events.js';
import { MAX_PROBABILITY, MIN_PROBABILITY } from '../predictions/canonical.js';
import { assertAscending, assertNoLookAhead } from './base.js';
import type { PredictContext } from './base.js';
import { climatologyModel } from './climatology.js';
import { coinflipModel } from './coinflip.js';
import { ewmaVolModel, magnitudeProbability, volatilityProbability } from './ewmaVol.js';
import { computeCodeHash } from './registry.js';
import type { HistoryBar } from '../predictions/build.js';

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussianPair(random: () => number): [number, number] {
  const u = Math.max(random(), 1e-12);
  const v = random();
  const radius = Math.sqrt(-2 * Math.log(u));
  const angle = 2 * Math.PI * v;
  return [radius * Math.cos(angle), radius * Math.sin(angle)];
}

function gaussianSeries(count: number, random: () => number): number[] {
  const values: number[] = [];
  while (values.length < count) {
    const [a, b] = gaussianPair(random);
    values.push(a);
    if (values.length < count) {
      values.push(b);
    }
  }
  return values;
}

function syntheticHistory(count: number, dailySigma: number, seed = 42): HistoryBar[] {
  const random = seededRandom(seed);
  const shocks = gaussianSeries(count, random);
  const bars: HistoryBar[] = [];
  let price = 100;
  const start = Date.UTC(2020, 0, 1);

  for (let index = 0; index < count; index += 1) {
    price *= Math.exp(shocks[index]! * dailySigma);
    bars.push({
      barDate: new Date(start + index * 86_400_000).toISOString().slice(0, 10),
      adjClose: price,
    });
  }

  return bars;
}

function contextFor(spec: EventSpec, history: HistoryBar[]): PredictContext {
  return {
    assetClass: 'crypto',
    horizon: '7d',
    windowBars: barsPerWindow('crypto', '7d'),
    spec,
    history,
  };
}

describe('guardas contra fuga de informacion', () => {
  const history = syntheticHistory(10, 0.02);

  it('rechaza barras que no son anteriores al slot', () => {
    const t0Date = history[5]!.barDate;
    expect(() => assertNoLookAhead(history, t0Date)).toThrow(/fuga de informacion futura/);
  });

  it('acepta un historial enteramente anterior al slot', () => {
    expect(() => assertNoLookAhead(history, '2030-01-01')).not.toThrow();
  });

  it('rechaza un historial desordenado', () => {
    const shuffled = [history[3]!, history[1]!, history[2]!];
    expect(() => assertAscending(shuffled)).toThrow(/no ordenado/);
  });
});

describe('buildEventSpecs', () => {
  const history = syntheticHistory(200, 0.02);

  it('produce cuatro eventos: dos MAG, uno VOL y uno DIR', () => {
    const specs = buildEventSpecs({ assetClass: 'crypto', horizon: '7d', history });
    expect(specs.map((spec) => spec.type)).toEqual(['MAG', 'MAG', 'VOL', 'DIR']);
  });

  it('el umbral de k=1.5 es exactamente 1.5 veces el de k=1.0', () => {
    const specs = buildEventSpecs({ assetClass: 'crypto', horizon: '7d', history });
    const [low, high] = specs;
    if (low?.type !== 'MAG' || high?.type !== 'MAG') {
      throw new Error('se esperaban dos eventos MAG');
    }
    expect(high.params.thresholdAbs / low.params.thresholdAbs).toBeCloseTo(1.5, 12);
  });

  it('escala el umbral con la raiz de las barras de la ventana', () => {
    const daily = buildEventSpecs({ assetClass: 'crypto', horizon: '1d', history });
    const weekly = buildEventSpecs({ assetClass: 'crypto', horizon: '7d', history });
    const dailyMag = daily[0];
    const weeklyMag = weekly[0];
    if (dailyMag?.type !== 'MAG' || weeklyMag?.type !== 'MAG') {
      throw new Error('se esperaban eventos MAG');
    }
    expect(weeklyMag.params.thresholdAbs / dailyMag.params.thresholdAbs).toBeCloseTo(
      Math.sqrt(7),
      10,
    );
  });

  it('congela rvPrevious con la volatilidad de la ventana anterior', () => {
    const specs = buildEventSpecs({ assetClass: 'crypto', horizon: '7d', history });
    const vol = specs.find((spec) => spec.type === 'VOL');
    if (vol?.type !== 'VOL') {
      throw new Error('se esperaba un evento VOL');
    }
    const returns = logReturns(history.map((bar) => bar.adjClose));
    expect(vol.params.rvPrevious).toBeCloseTo(realizedVolatility(returns.slice(-7)), 12);
  });

  it('rechaza un historial demasiado corto', () => {
    const required = minimumHistoryBars('7d', 'crypto');
    const short = syntheticHistory(required - 1, 0.02);
    expect(() => buildEventSpecs({ assetClass: 'crypto', horizon: '7d', history: short })).toThrow(
      /historial insuficiente/,
    );
  });

  it('exige mas historial del que consume sigma', () => {
    expect(minimumHistoryBars('7d', 'crypto')).toBeGreaterThan(SIGMA_WINDOW);
  });
});

describe('coinflip', () => {
  it('devuelve siempre 0.5', () => {
    const history = syntheticHistory(200, 0.02);
    const specs = buildEventSpecs({ assetClass: 'crypto', horizon: '7d', history });
    for (const spec of specs) {
      expect(coinflipModel.predict(contextFor(spec, history))).toBe(0.5);
    }
  });

  it('no necesita historial', () => {
    expect(coinflipModel.minimumHistory(7)).toBe(0);
  });
});

describe('climatology', () => {
  const history = syntheticHistory(600, 0.02);
  const specs = buildEventSpecs({ assetClass: 'crypto', horizon: '7d', history });

  it('devuelve probabilidades dentro del rango permitido', () => {
    for (const spec of specs) {
      const probability = climatologyModel.predict(contextFor(spec, history));
      expect(probability).toBeGreaterThanOrEqual(MIN_PROBABILITY);
      expect(probability).toBeLessThanOrEqual(MAX_PROBABILITY);
    }
  });

  it('la tasa base de direccion en un paseo aleatorio ronda 0.5', () => {
    const dir = specs.find((spec) => spec.type === 'DIR')!;
    expect(climatologyModel.predict(contextFor(dir, history))).toBeCloseTo(0.5, 1);
  });

  it('la tasa base de subida de volatilidad ronda 0.5', () => {
    const vol = specs.find((spec) => spec.type === 'VOL')!;
    expect(climatologyModel.predict(contextFor(vol, history))).toBeCloseTo(0.5, 1);
  });

  it('un umbral mas alto siempre da una tasa base menor o igual', () => {
    const mags = specs.filter((spec) => spec.type === 'MAG');
    const low = climatologyModel.predict(contextFor(mags[0]!, history));
    const high = climatologyModel.predict(contextFor(mags[1]!, history));
    expect(high).toBeLessThanOrEqual(low);
  });
});

describe('ewmaVol', () => {
  it('no emite direccion', () => {
    expect(ewmaVolModel.supports('DIR')).toBe(false);
    expect(ewmaVolModel.supports('MAG')).toBe(true);
    expect(ewmaVolModel.supports('VOL')).toBe(true);
  });

  it('un umbral mas alto da menos probabilidad', () => {
    const low = magnitudeProbability(0.05, 0.02, 7);
    const high = magnitudeProbability(0.1, 0.02, 7);
    expect(high).toBeLessThan(low);
  });

  it('mas volatilidad da mas probabilidad de superar el umbral', () => {
    const calm = magnitudeProbability(0.05, 0.01, 7);
    const wild = magnitudeProbability(0.05, 0.04, 7);
    expect(wild).toBeGreaterThan(calm);
  });

  it('un umbral simetrico en retorno simple no es simetrico en log', () => {
    const dailySigma = 0.02;
    const windowSigma = dailySigma * Math.sqrt(7);
    const threshold = Math.exp(windowSigma) - 1;
    const probability = magnitudeProbability(threshold, dailySigma, 7);

    expect(probability).toBeLessThan(0.3173);
    expect(probability).toBeGreaterThan(0.29);
  });

  it('la asimetria se reduce monotonamente al reducir sigma', () => {
    const gaussianTwoTails = 0.3173105;
    const gapAt = (dailySigma: number): number => {
      const windowSigma = dailySigma * Math.sqrt(7);
      const threshold = Math.exp(windowSigma) - 1;
      return gaussianTwoTails - magnitudeProbability(threshold, dailySigma, 7);
    };

    const wide = gapAt(0.05);
    const narrow = gapAt(0.005);
    const tiny = gapAt(0.0005);

    expect(wide).toBeGreaterThan(narrow);
    expect(narrow).toBeGreaterThan(tiny);
    expect(tiny).toBeGreaterThan(0);
    expect(tiny).toBeLessThan(1e-3);
  });

  it('rechaza umbrales no representables', () => {
    expect(() => magnitudeProbability(0, 0.02, 7)).toThrow(/positivo/);
    expect(() => magnitudeProbability(1, 0.02, 7)).toThrow(/100%/);
  });

  it('la probabilidad de subida de volatilidad ronda 0.5 cuando rvPrevious iguala sigma', () => {
    expect(volatilityProbability(0.02, 0.02, 7)).toBeGreaterThan(0.35);
    expect(volatilityProbability(0.02, 0.02, 7)).toBeLessThan(0.65);
  });

  it('si la volatilidad previa fue muy alta, es improbable superarla', () => {
    expect(volatilityProbability(0.2, 0.02, 7)).toBeLessThan(0.01);
  });

  it('si la volatilidad previa fue muy baja, es probable superarla', () => {
    expect(volatilityProbability(0.001, 0.02, 7)).toBeGreaterThan(0.99);
  });

  it('produce probabilidades validas sobre historial sintetico', () => {
    const history = syntheticHistory(300, 0.03);
    const specs = buildEventSpecs({ assetClass: 'crypto', horizon: '7d', history });
    for (const spec of specs.filter((s) => ewmaVolModel.supports(s.type))) {
      const probability = ewmaVolModel.predict(contextFor(spec, history));
      expect(probability).toBeGreaterThanOrEqual(MIN_PROBABILITY);
      expect(probability).toBeLessThanOrEqual(MAX_PROBABILITY);
    }
  });
});

describe('computeCodeHash', () => {
  it('es estable entre llamadas', () => {
    expect(computeCodeHash(ewmaVolModel)).toBe(computeCodeHash(ewmaVolModel));
  });

  it('distingue modelos distintos', () => {
    expect(computeCodeHash(coinflipModel)).not.toBe(computeCodeHash(climatologyModel));
  });

  it('cambia si cambia la version declarada', () => {
    const bumped = { ...ewmaVolModel, version: '1.0.1' };
    expect(computeCodeHash(bumped)).not.toBe(computeCodeHash(ewmaVolModel));
  });

  it('cambia si cambian los parametros', () => {
    const retuned = { ...ewmaVolModel, params: { lambda: 0.97 } };
    expect(computeCodeHash(retuned)).not.toBe(computeCodeHash(ewmaVolModel));
  });

  it('cambia si cambia el cuerpo de predict', () => {
    const rewritten = { ...ewmaVolModel, predict: () => 0.5 };
    expect(computeCodeHash(rewritten)).not.toBe(computeCodeHash(ewmaVolModel));
  });
});
