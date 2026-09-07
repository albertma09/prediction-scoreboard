import { describe, expect, it } from 'vitest';
import {
  baseRate,
  blockBootstrapSkillScore,
  brierScore,
  brierSkillScore,
  calibrationBins,
  meanBrier,
  murphyDecomposition,
  pooledSkillScore,
} from './brier.js';
import type { PairedScore, ScoredPrediction } from './brier.js';

function scored(pairs: Array<[number, 0 | 1]>): ScoredPrediction[] {
  return pairs.map(([probability, outcome]) => ({ probability, outcome }));
}

describe('brierScore', () => {
  it('vale 0 cuando la certeza acierta', () => {
    expect(brierScore(1, 1)).toBe(0);
    expect(brierScore(0, 0)).toBe(0);
  });

  it('vale 1 cuando la certeza falla', () => {
    expect(brierScore(1, 0)).toBe(1);
    expect(brierScore(0, 1)).toBe(1);
  });

  it('vale 0.25 en la ignorancia total', () => {
    expect(brierScore(0.5, 1)).toBe(0.25);
    expect(brierScore(0.5, 0)).toBe(0.25);
  });

  it('castiga exagerar la confianza mas que quedarse corto', () => {
    const overconfidentAndWrong = brierScore(0.9, 0);
    const humbleAndWrong = brierScore(0.6, 0);
    expect(overconfidentAndWrong).toBeGreaterThan(humbleAndWrong);
  });

  it('calcula valores conocidos a mano', () => {
    expect(brierScore(0.7, 1)).toBeCloseTo(0.09, 12);
    expect(brierScore(0.3, 1)).toBeCloseTo(0.49, 12);
  });

  it('rechaza probabilidades fuera de rango', () => {
    expect(() => brierScore(1.5, 1)).toThrow(/invalida/);
    expect(() => brierScore(-0.1, 0)).toThrow(/invalida/);
    expect(() => brierScore(Number.NaN, 0)).toThrow(/invalida/);
  });
});

describe('meanBrier y baseRate', () => {
  const items = scored([
    [0.8, 1],
    [0.6, 0],
    [0.4, 1],
    [0.2, 0],
  ]);

  it('promedia los Brier individuales', () => {
    const expected = (0.04 + 0.36 + 0.36 + 0.04) / 4;
    expect(meanBrier(items)).toBeCloseTo(expected, 12);
  });

  it('calcula la tasa base observada', () => {
    expect(baseRate(items)).toBe(0.5);
  });

  it('rechaza conjuntos vacios', () => {
    expect(() => meanBrier([])).toThrow(/vacio/);
    expect(() => baseRate([])).toThrow(/vacio/);
  });
});

describe('brierSkillScore', () => {
  it('es 0 cuando el modelo iguala al baseline', () => {
    expect(brierSkillScore(0.25, 0.25)).toBe(0);
  });

  it('es positivo cuando el modelo mejora al baseline', () => {
    expect(brierSkillScore(0.2, 0.25)).toBeCloseTo(0.2, 12);
  });

  it('es negativo cuando el modelo empeora al baseline', () => {
    expect(brierSkillScore(0.3, 0.25)).toBeCloseTo(-0.2, 12);
  });

  it('es 1 con un modelo perfecto', () => {
    expect(brierSkillScore(0, 0.25)).toBe(1);
  });

  it('rechaza un baseline perfecto', () => {
    expect(() => brierSkillScore(0.1, 0)).toThrow(/no esta definido/);
  });
});

describe('pooledSkillScore', () => {
  it('se calcula sobre los Brier agregados, no promediando skills por fila', () => {
    const items: PairedScore[] = [
      { modelProbability: 0.9, baselineProbability: 0.5, outcome: 1 },
      { modelProbability: 0.5, baselineProbability: 0.5, outcome: 0 },
    ];

    const modelBrier = (0.01 + 0.25) / 2;
    const baselineBrier = (0.25 + 0.25) / 2;
    expect(pooledSkillScore(items)).toBeCloseTo(1 - modelBrier / baselineBrier, 12);
  });

  it('un modelo que siempre dice la tasa base tiene skill 0 frente a si mismo', () => {
    const items: PairedScore[] = Array.from({ length: 100 }, (_, index) => ({
      modelProbability: 0.6,
      baselineProbability: 0.6,
      outcome: index < 60 ? 1 : 0,
    }));
    expect(pooledSkillScore(items)).toBe(0);
  });

  it('detecta la trampa del acierto: predecir siempre el lado mayoritario no da skill', () => {
    const alwaysUp: PairedScore[] = Array.from({ length: 100 }, (_, index) => ({
      modelProbability: 0.999,
      baselineProbability: 0.55,
      outcome: index < 55 ? 1 : 0,
    }));

    expect(pooledSkillScore(alwaysUp)).toBeLessThan(0);
  });
});

describe('calibrationBins', () => {
  it('reparte las predicciones en el bin correcto', () => {
    const bins = calibrationBins(scored([
      [0.05, 0],
      [0.15, 0],
      [0.95, 1],
    ]), 10);

    expect(bins[0]?.count).toBe(1);
    expect(bins[1]?.count).toBe(1);
    expect(bins[9]?.count).toBe(1);
  });

  it('mete la probabilidad 1 en el ultimo bin, no fuera del array', () => {
    const bins = calibrationBins(scored([[1, 1]]), 10);
    expect(bins[9]?.count).toBe(1);
  });

  it('un predictor perfectamente calibrado sigue la diagonal', () => {
    const items: ScoredPrediction[] = [];
    for (let index = 0; index < 100; index += 1) {
      items.push({ probability: 0.75, outcome: index < 75 ? 1 : 0 });
    }
    const bins = calibrationBins(items, 10);
    const bin = bins[7];
    expect(bin?.count).toBe(100);
    expect(bin?.meanForecast).toBeCloseTo(0.75, 12);
    expect(bin?.observedFrequency).toBeCloseTo(0.75, 12);
  });

  it('deja los bins vacios con recuento 0 para que no se dibujen como fiables', () => {
    const bins = calibrationBins(scored([[0.55, 1]]), 10);
    expect(bins.filter((bin) => bin.count === 0)).toHaveLength(9);
  });

  it('rechaza menos de dos bins', () => {
    expect(() => calibrationBins(scored([[0.5, 1]]), 1)).toThrow(/al menos 2/);
  });
});

describe('murphyDecomposition', () => {
  it('cumple brier = fiabilidad - resolucion + incertidumbre', () => {
    const items = scored([
      [0.8, 1],
      [0.8, 1],
      [0.8, 0],
      [0.3, 0],
      [0.3, 1],
      [0.3, 0],
      [0.5, 1],
      [0.5, 0],
    ]);

    const parts = murphyDecomposition(items);
    expect(parts.reliability - parts.resolution + parts.uncertainty).toBeCloseTo(
      parts.brier,
      12,
    );
  });

  it('un predictor perfectamente calibrado tiene fiabilidad 0', () => {
    const items: ScoredPrediction[] = [];
    for (let index = 0; index < 10; index += 1) {
      items.push({ probability: 0.8, outcome: index < 8 ? 1 : 0 });
    }
    for (let index = 0; index < 10; index += 1) {
      items.push({ probability: 0.3, outcome: index < 3 ? 1 : 0 });
    }

    const parts = murphyDecomposition(items);
    expect(parts.reliability).toBeCloseTo(0, 12);
    expect(parts.resolution).toBeGreaterThan(0);
  });

  it('un predictor que siempre dice la tasa base esta calibrado pero no resuelve nada', () => {
    const items: ScoredPrediction[] = Array.from({ length: 100 }, (_, index) => ({
      probability: 0.4,
      outcome: index < 40 ? 1 : 0,
    }));

    const parts = murphyDecomposition(items);
    expect(parts.reliability).toBeCloseTo(0, 12);
    expect(parts.resolution).toBeCloseTo(0, 12);
    expect(parts.brier).toBeCloseTo(parts.uncertainty, 12);
  });
});

describe('blockBootstrapSkillScore', () => {
  function pairedSeries(count: number, modelProbability: number, hitRate: number): PairedScore[] {
    return Array.from({ length: count }, (_, index) => ({
      modelProbability,
      baselineProbability: 0.5,
      outcome: index % 100 < hitRate * 100 ? 1 : 0,
    }));
  }

  it('el intervalo contiene el estimador puntual', () => {
    const items = pairedSeries(400, 0.7, 0.7);
    const interval = blockBootstrapSkillScore(items, { blockSize: 7, iterations: 500 });
    expect(interval.lower).toBeLessThanOrEqual(interval.point);
    expect(interval.upper).toBeGreaterThanOrEqual(interval.point);
  });

  it('es reproducible con la misma semilla', () => {
    const items = pairedSeries(300, 0.65, 0.65);
    const a = blockBootstrapSkillScore(items, { seed: 7, iterations: 300 });
    const b = blockBootstrapSkillScore(items, { seed: 7, iterations: 300 });
    expect(a.lower).toBe(b.lower);
    expect(a.upper).toBe(b.upper);
  });

  it('bloques mas grandes dan intervalos mas anchos en series solapadas', () => {
    const items = pairedSeries(700, 0.7, 0.7);
    const iid = blockBootstrapSkillScore(items, { blockSize: 1, iterations: 800, seed: 3 });
    const blocked = blockBootstrapSkillScore(items, { blockSize: 7, iterations: 800, seed: 3 });
    expect(blocked.upper - blocked.lower).toBeGreaterThan(iid.upper - iid.lower);
  });

  it('un modelo sin habilidad produce un intervalo que cruza el cero', () => {
    const items: PairedScore[] = Array.from({ length: 500 }, (_, index) => ({
      modelProbability: 0.5,
      baselineProbability: 0.5,
      outcome: index % 2 === 0 ? 1 : 0,
    }));

    const interval = blockBootstrapSkillScore(items, { iterations: 500 });
    expect(interval.lower).toBeLessThanOrEqual(0);
    expect(interval.upper).toBeGreaterThanOrEqual(0);
  });

  it('rechaza bloques mas grandes que la serie', () => {
    expect(() =>
      blockBootstrapSkillScore(pairedSeries(5, 0.6, 0.6), { blockSize: 10 }),
    ).toThrow(/no hay suficientes observaciones/);
  });
});
