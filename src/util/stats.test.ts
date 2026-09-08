import { describe, expect, it } from 'vitest';
import {
  chi2UpperTail,
  erf,
  ewmaVariance,
  ewmaVarianceSeries,
  mean,
  normalCdf,
  regularizedBetaI,
  regularizedGammaQ,
  sampleStdev,
  studentTCdf,
  unitVarianceTScale,
} from './stats.js';

describe('mean y sampleStdev', () => {
  it('calcula la media', () => {
    expect(mean([1, 2, 3, 4])).toBe(2.5);
  });

  it('calcula la desviacion tipica muestral', () => {
    expect(sampleStdev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.13809, 4);
  });

  it('rechaza conjuntos demasiado pequenios', () => {
    expect(() => mean([])).toThrow(/vacio/);
    expect(() => sampleStdev([1])).toThrow(/al menos 2/);
  });
});

describe('erf y normalCdf', () => {
  it('erf en valores conocidos', () => {
    expect(erf(0)).toBeCloseTo(0, 6);
    expect(erf(1)).toBeCloseTo(0.8427008, 6);
    expect(erf(-1)).toBeCloseTo(-0.8427008, 6);
  });

  it('normalCdf en valores de tabla', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1)).toBeCloseTo(0.8413447, 6);
    expect(normalCdf(-1)).toBeCloseTo(0.1586553, 6);
    expect(normalCdf(1.959964)).toBeCloseTo(0.975, 6);
    expect(normalCdf(2.575829)).toBeCloseTo(0.995, 6);
  });

  it('es simetrica', () => {
    for (const x of [0.3, 1.1, 2.4, 3.2]) {
      expect(normalCdf(x) + normalCdf(-x)).toBeCloseTo(1, 6);
    }
  });
});

describe('chi2UpperTail', () => {
  it('coincide con los valores criticos al 5%', () => {
    expect(chi2UpperTail(3.841459, 1)).toBeCloseTo(0.05, 5);
    expect(chi2UpperTail(5.991465, 2)).toBeCloseTo(0.05, 5);
    expect(chi2UpperTail(11.070498, 5)).toBeCloseTo(0.05, 5);
    expect(chi2UpperTail(14.067140, 7)).toBeCloseTo(0.05, 5);
  });

  it('coincide con los valores criticos al 1%', () => {
    expect(chi2UpperTail(6.634897, 1)).toBeCloseTo(0.01, 5);
    expect(chi2UpperTail(15.086272, 5)).toBeCloseTo(0.01, 5);
  });

  it('vale 1 en el origen y decrece', () => {
    expect(chi2UpperTail(0, 3)).toBe(1);
    expect(chi2UpperTail(1, 3)).toBeGreaterThan(chi2UpperTail(5, 3));
  });

  it('la mediana de chi2 con 1 grado esta en 0.4549', () => {
    expect(chi2UpperTail(0.4549364, 1)).toBeCloseTo(0.5, 5);
  });

  it('rechaza parametros invalidos', () => {
    expect(() => chi2UpperTail(1, 0)).toThrow(/positivos/);
    expect(() => regularizedGammaQ(1, -1)).toThrow(/negativo/);
  });
});

describe('ewmaVariance', () => {
  const calm = Array.from({ length: 60 }, () => 0.001);
  const wild = Array.from({ length: 60 }, () => 0.05);

  it('con un solo retorno devuelve su cuadrado', () => {
    expect(ewmaVariance([0.02], 0.94)).toBeCloseTo(0.0004, 12);
  });

  it('pondera mas los retornos recientes', () => {
    const calmThenWild = ewmaVariance([...calm, ...wild], 0.94);
    const wildThenCalm = ewmaVariance([...wild, ...calm], 0.94);
    expect(calmThenWild).toBeGreaterThan(wildThenCalm);
  });

  it('la semilla es la varianza del bloque inicial, no el primer retorno', () => {
    const spikeFirst = ewmaVariance([0.5, ...Array.from({ length: 19 }, () => 0.01)], 0.94, 20);
    const meanOfSquares = (0.25 + 19 * 0.0001) / 20;
    expect(spikeFirst).toBeCloseTo(meanOfSquares, 12);
  });

  it('con lambda 0.94 una serie corta esta dominada por su semilla', () => {
    const calmThenWildShort = ewmaVariance([0.001, 0.001, 0.001, 0.05], 0.94, 2);
    const wildThenCalmShort = ewmaVariance([0.05, 0.001, 0.001, 0.001], 0.94, 2);
    expect(wildThenCalmShort).toBeGreaterThan(calmThenWildShort);
  });

  it('con lambda de memoria corta la recencia domina enseguida', () => {
    const calmThenWildShort = ewmaVariance([0.001, 0.001, 0.001, 0.05], 0.5, 2);
    const wildThenCalmShort = ewmaVariance([0.05, 0.001, 0.001, 0.001], 0.5, 2);
    expect(calmThenWildShort).toBeGreaterThan(wildThenCalmShort);
  });

  it('converge a la varianza constante con retornos constantes', () => {
    const constant = Array.from({ length: 500 }, () => 0.01);
    expect(ewmaVariance(constant, 0.94)).toBeCloseTo(0.0001, 10);
  });

  it('rechaza lambda fuera de rango', () => {
    expect(() => ewmaVariance([0.01], 0)).toThrow(/lambda/);
    expect(() => ewmaVariance([0.01], 1)).toThrow(/lambda/);
  });
});

describe('studentTCdf', () => {
  it('vale 0.5 en el origen', () => {
    expect(studentTCdf(0, 5)).toBeCloseTo(0.5, 12);
  });

  it('es simetrica', () => {
    for (const x of [0.3, 1, 2.5, 4]) {
      expect(studentTCdf(-x, 5)).toBeCloseTo(1 - studentTCdf(x, 5), 12);
    }
  });

  it('reproduce cuantiles tabulados', () => {
    expect(studentTCdf(2.015048, 5)).toBeCloseTo(0.95, 5);
    expect(studentTCdf(3.36493, 5)).toBeCloseTo(0.99, 5);
    expect(studentTCdf(1.812461, 10)).toBeCloseTo(0.95, 5);
  });

  it('es monotona creciente', () => {
    let previous = 0;
    for (const x of [-4, -2, -1, 0, 1, 2, 4]) {
      const value = studentTCdf(x, 5);
      expect(value).toBeGreaterThan(previous);
      previous = value;
    }
  });

  it('tiene colas mas gruesas que la normal una vez igualada la varianza', () => {
    const degreesOfFreedom = 5;
    const scale = unitVarianceTScale(degreesOfFreedom);
    const normalTail = 1 - normalCdf(3);
    const studentTail = 1 - studentTCdf(3 * scale, degreesOfFreedom);
    expect(studentTail).toBeGreaterThan(normalTail);
  });

  it('converge a la normal con muchos grados de libertad', () => {
    expect(studentTCdf(1.5, 20000)).toBeCloseTo(normalCdf(1.5), 4);
  });

  it('rechaza grados de libertad no positivos', () => {
    expect(() => studentTCdf(1, 0)).toThrow(/grados de libertad/);
  });
});

describe('unitVarianceTScale', () => {
  it('exige varianza finita', () => {
    expect(() => unitVarianceTScale(2)).toThrow(/varianza finita/);
  });

  it('tiende a 1 con muchos grados de libertad', () => {
    expect(unitVarianceTScale(100000)).toBeCloseTo(1, 4);
  });
});

describe('regularizedBetaI', () => {
  it('vale 0 y 1 en los extremos', () => {
    expect(regularizedBetaI(2, 3, 0)).toBe(0);
    expect(regularizedBetaI(2, 3, 1)).toBe(1);
  });

  it('cumple la simetria I_x(a,b) = 1 - I_{1-x}(b,a)', () => {
    expect(regularizedBetaI(2.5, 4, 0.3)).toBeCloseTo(1 - regularizedBetaI(4, 2.5, 0.7), 12);
  });

  it('rechaza parametros no positivos', () => {
    expect(() => regularizedBetaI(0, 1, 0.5)).toThrow(/positivos/);
  });
});

describe('ewmaVarianceSeries', () => {
  const returns = [0.01, -0.02, 0.015, -0.005, 0.03, -0.01, 0.02, -0.025, 0.005, 0.012];

  it('coincide con ewmaVariance en todos los prefijos', () => {
    for (let length = 1; length <= returns.length; length += 1) {
      const series = ewmaVarianceSeries(returns, 0.94, 4);
      const single = ewmaVariance(returns.slice(0, length), 0.94, 4);
      expect(series[length - 1]).toBeCloseTo(single, 15);
    }
  });

  it('devuelve un valor por retorno', () => {
    expect(ewmaVarianceSeries(returns, 0.94).length).toBe(returns.length);
  });

  it('no depende de los retornos futuros', () => {
    const short = ewmaVarianceSeries(returns.slice(0, 6), 0.94, 4);
    const long = ewmaVarianceSeries(returns, 0.94, 4);
    expect(long.slice(0, 6)).toEqual(short);
  });

  it('rechaza series vacias y lambda fuera de rango', () => {
    expect(() => ewmaVarianceSeries([], 0.94)).toThrow(/sin retornos/);
    expect(() => ewmaVarianceSeries(returns, 1)).toThrow(/lambda/);
  });
});
