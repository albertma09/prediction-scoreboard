import { describe, expect, it } from 'vitest';
import { buildEventSpecs } from '../predictions/build.js';
import type { HistoryBar } from '../predictions/build.js';
import { barsPerWindow } from '../predictions/events.js';
import type { EventSpec } from '../predictions/events.js';
import { MAX_PROBABILITY, MIN_PROBABILITY } from '../predictions/canonical.js';
import type { PredictContext } from './base.js';
import { applySlope, fitSlope, logit, NEUTRAL_SLOPE, sigmoid } from './calibration.js';
import type { CalibrationPair } from './calibration.js';
import { ewmaVolModel, LAMBDA } from './ewmaVol.js';
import { volCalModel } from './volCal.js';
import { historicalVolatilityPairs } from './volPairs.js';
import { computeCodeHash } from './registry.js';

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

function syntheticHistory(count: number, dailySigma: number, seed = 7): HistoryBar[] {
  const random = seededRandom(seed);
  const bars: HistoryBar[] = [];
  const start = Date.UTC(2020, 0, 1);
  let price = 100;

  for (let index = 0; index < count; index += 1) {
    const u = Math.max(random(), 1e-12);
    const v = random();
    const shock = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    price *= Math.exp(shock * dailySigma);
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

function volSpecOf(history: HistoryBar[]): EventSpec {
  const specs = buildEventSpecs({ assetClass: 'crypto', horizon: '7d', history });
  const vol = specs.find((spec) => spec.type === 'VOL');
  if (vol === undefined) {
    throw new Error('se esperaba un evento VOL');
  }
  return vol;
}

function overconfidentPairs(trueSlope: number): CalibrationPair[] {
  const pairs: CalibrationPair[] = [];

  for (let step = 1; step <= 9; step += 1) {
    const truth = step / 10;
    const stated = sigmoid(logit(truth) / trueSlope);
    const hits = Math.round(100 * truth);
    for (let index = 0; index < 100; index += 1) {
      pairs.push({ probability: stated, outcome: index < hits ? 1 : 0 });
    }
  }

  return pairs;
}

describe('applySlope', () => {
  it('con pendiente 1 devuelve la probabilidad intacta', () => {
    for (const probability of [0.02, 0.15, 0.5, 0.83, 0.97]) {
      expect(applySlope(probability, 1)).toBeCloseTo(probability, 9);
    }
  });

  it('con pendiente menor que 1 acerca la probabilidad a 0.5', () => {
    expect(applySlope(0.9, 0.5)).toBeLessThan(0.9);
    expect(applySlope(0.9, 0.5)).toBeGreaterThan(0.5);
    expect(applySlope(0.1, 0.5)).toBeGreaterThan(0.1);
    expect(applySlope(0.1, 0.5)).toBeLessThan(0.5);
  });

  it('deja 0.5 en su sitio con cualquier pendiente', () => {
    expect(applySlope(0.5, 0.3)).toBeCloseTo(0.5, 12);
    expect(applySlope(0.5, 1.4)).toBeCloseTo(0.5, 12);
  });

  it('respeta los limites de probabilidad', () => {
    expect(applySlope(0.999999, 1.5)).toBeLessThanOrEqual(MAX_PROBABILITY);
    expect(applySlope(0.000001, 1.5)).toBeGreaterThanOrEqual(MIN_PROBABILITY);
  });
});

describe('fitSlope', () => {
  it('no corrige nada si hay pocos pares', () => {
    expect(fitSlope(overconfidentPairs(0.5).slice(0, 40))).toBe(NEUTRAL_SLOPE);
    expect(fitSlope([])).toBe(NEUTRAL_SLOPE);
  });

  it('recupera la pendiente que genero el exceso de confianza', () => {
    expect(fitSlope(overconfidentPairs(0.5))).toBeCloseTo(0.5, 3);
    expect(fitSlope(overconfidentPairs(0.8))).toBeCloseTo(0.8, 3);
  });

  it('no toca un conjunto ya calibrado', () => {
    expect(fitSlope(overconfidentPairs(1))).toBeCloseTo(1, 2);
  });

  it('nunca sale del rango de busqueda', () => {
    const extreme = fitSlope(overconfidentPairs(0.15));
    expect(extreme).toBeGreaterThanOrEqual(0.2);
    expect(extreme).toBeLessThanOrEqual(1.5);
  });
});

describe('historicalVolatilityPairs: no mira al futuro', () => {
  const short = syntheticHistory(300, 0.02);
  const long = [...short, ...syntheticHistory(100, 0.02, 99)];
  const options = { windowBars: 7, lambda: LAMBDA };

  it('los pares de un historial corto son prefijo de los del historial largo', () => {
    const fromShort = historicalVolatilityPairs({ ...options, history: short });
    const fromLong = historicalVolatilityPairs({ ...options, history: long });

    expect(fromShort.length).toBeGreaterThan(0);
    expect(fromLong.length).toBeGreaterThan(fromShort.length);
    expect(fromLong.slice(0, fromShort.length)).toEqual(fromShort);
  });

  it('cada barra nueva aporta exactamente un par', () => {
    const base = historicalVolatilityPairs({ ...options, history: short });
    const plusOne = historicalVolatilityPairs({
      ...options,
      history: short.slice(0, short.length - 1),
    });
    expect(base.length - plusOne.length).toBe(1);
  });

  it('devuelve una lista vacia si no cabe ni un par resuelto', () => {
    const scarce = syntheticHistory(67, 0.02);
    expect(historicalVolatilityPairs({ ...options, history: scarce })).toEqual([]);
  });

  it('solo produce desenlaces binarios y probabilidades validas', () => {
    for (const pair of historicalVolatilityPairs({ ...options, history: short })) {
      expect([0, 1]).toContain(pair.outcome);
      expect(pair.probability).toBeGreaterThanOrEqual(MIN_PROBABILITY);
      expect(pair.probability).toBeLessThanOrEqual(MAX_PROBABILITY);
    }
  });

  it('en un paseo aleatorio la mitad de los desenlaces son subidas de volatilidad', () => {
    const pairs = historicalVolatilityPairs({
      ...options,
      history: syntheticHistory(1500, 0.02, 21),
    });
    const hits = pairs.filter((pair) => pair.outcome === 1).length;
    expect(hits / pairs.length).toBeCloseTo(0.5, 1);
  });
});

describe('volCal', () => {
  const history = syntheticHistory(500, 0.02);
  const vol = volSpecOf(history);

  it('solo emite volatilidad', () => {
    expect(volCalModel.supports('VOL')).toBe(true);
    expect(volCalModel.supports('MAG')).toBe(false);
    expect(volCalModel.supports('DIR')).toBe(false);
  });

  it('rechaza cualquier evento que no sea de volatilidad', () => {
    const specs = buildEventSpecs({ assetClass: 'crypto', horizon: '7d', history });
    for (const spec of specs.filter((candidate) => candidate.type !== 'VOL')) {
      expect(() => volCalModel.predict(contextFor(spec, history))).toThrow(
        /solo emite predicciones de volatilidad/,
      );
    }
  });

  it('exige el mismo historial minimo que ewmaVol', () => {
    for (const windowBars of [1, 5, 7]) {
      expect(volCalModel.minimumHistory(windowBars)).toBe(
        ewmaVolModel.minimumHistory(windowBars),
      );
    }
  });

  it('emite dentro del rango permitido', () => {
    const probability = volCalModel.predict(contextFor(vol, history));
    expect(probability).toBeGreaterThanOrEqual(MIN_PROBABILITY);
    expect(probability).toBeLessThanOrEqual(MAX_PROBABILITY);
  });

  it('sin pares suficientes coincide con ewmaVol', () => {
    const scarce = syntheticHistory(67, 0.02);
    const scarceVol = volSpecOf(scarce);
    expect(volCalModel.predict(contextFor(scarceVol, scarce))).toBeCloseTo(
      ewmaVolModel.predict(contextFor(scarceVol, scarce)),
      9,
    );
  });

  it('con historial largo se separa de ewmaVol', () => {
    expect(volCalModel.predict(contextFor(vol, history))).not.toBe(
      ewmaVolModel.predict(contextFor(vol, history)),
    );
  });

  it('es determinista', () => {
    const first = volCalModel.predict(contextFor(vol, history));
    const second = volCalModel.predict(contextFor(vol, history));
    expect(second).toBe(first);
  });

  it('no depende de las barras posteriores al slot', () => {
    const extended = [...history, ...syntheticHistory(50, 0.05, 123)];
    const fromHistory = volCalModel.predict(contextFor(vol, history));
    const fromPrefix = volCalModel.predict(
      contextFor(vol, extended.slice(0, history.length)),
    );
    expect(fromPrefix).toBe(fromHistory);
  });

  it('tiene un hash de codigo distinto al de ewmaVol', () => {
    expect(computeCodeHash(volCalModel)).not.toBe(computeCodeHash(ewmaVolModel));
  });
});
