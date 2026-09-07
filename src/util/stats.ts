export function mean(values: readonly number[]): number {
  if (values.length === 0) {
    throw new Error('media de un conjunto vacio');
  }
  return values.reduce((total, value) => total + value, 0) / values.length;
}

export function sampleStdev(values: readonly number[]): number {
  if (values.length < 2) {
    throw new Error('la desviacion tipica muestral necesita al menos 2 observaciones');
  }
  const average = mean(values);
  const sumSquares = values.reduce((total, value) => total + (value - average) ** 2, 0);
  return Math.sqrt(sumSquares / (values.length - 1));
}

export function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x);

  const t = 1 / (1 + 0.3275911 * absX);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t *
      Math.exp(-absX * absX);

  return sign * y;
}

export function normalCdf(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

const GAMMA_MAX_ITERATIONS = 300;
const GAMMA_EPSILON = 1e-14;
const FPMIN = 1e-300;

function logGamma(x: number): number {
  const coefficients = [
    76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155,
    0.1208650973866179e-2, -0.5395239384953e-5,
  ];

  let y = x;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let series = 1.000000000190015;

  for (const coefficient of coefficients) {
    y += 1;
    series += coefficient / y;
  }

  return -tmp + Math.log((2.5066282746310005 * series) / x);
}

function lowerGammaSeries(a: number, x: number): number {
  let sum = 1 / a;
  let term = sum;

  for (let n = 1; n <= GAMMA_MAX_ITERATIONS; n += 1) {
    term *= x / (a + n);
    sum += term;
    if (Math.abs(term) < Math.abs(sum) * GAMMA_EPSILON) {
      break;
    }
  }

  return sum * Math.exp(-x + a * Math.log(x) - logGamma(a));
}

function upperGammaContinuedFraction(a: number, x: number): number {
  let b = x + 1 - a;
  let c = 1 / FPMIN;
  let d = 1 / b;
  let h = d;

  for (let i = 1; i <= GAMMA_MAX_ITERATIONS; i += 1) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < FPMIN) {
      d = FPMIN;
    }
    c = b + an / c;
    if (Math.abs(c) < FPMIN) {
      c = FPMIN;
    }
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < GAMMA_EPSILON) {
      break;
    }
  }

  return Math.exp(-x + a * Math.log(x) - logGamma(a)) * h;
}

export function regularizedGammaQ(a: number, x: number): number {
  if (a <= 0) {
    throw new Error('el parametro a de la gamma incompleta debe ser positivo');
  }
  if (x < 0) {
    throw new Error('el argumento x de la gamma incompleta no puede ser negativo');
  }
  if (x === 0) {
    return 1;
  }
  if (x < a + 1) {
    return 1 - lowerGammaSeries(a, x);
  }
  return upperGammaContinuedFraction(a, x);
}

export function chi2UpperTail(x: number, degreesOfFreedom: number): number {
  if (degreesOfFreedom <= 0) {
    throw new Error('los grados de libertad deben ser positivos');
  }
  return regularizedGammaQ(degreesOfFreedom / 2, x / 2);
}

export const EWMA_SEED_LENGTH = 20;

export function ewmaVariance(
  returns: readonly number[],
  lambda: number,
  seedLength = EWMA_SEED_LENGTH,
): number {
  if (returns.length === 0) {
    throw new Error('no se puede calcular EWMA sin retornos');
  }
  if (lambda <= 0 || lambda >= 1) {
    throw new Error(`lambda fuera de rango: ${lambda}`);
  }
  if (seedLength < 1) {
    throw new Error(`longitud de semilla invalida: ${seedLength}`);
  }

  const seedCount = Math.min(seedLength, returns.length);
  let seedSumSquares = 0;
  for (let index = 0; index < seedCount; index += 1) {
    const value = returns[index];
    if (value === undefined) {
      throw new Error('serie de retornos invalida');
    }
    seedSumSquares += value * value;
  }

  let variance = seedSumSquares / seedCount;

  for (let index = seedCount; index < returns.length; index += 1) {
    const value = returns[index];
    if (value === undefined) {
      throw new Error('serie de retornos invalida');
    }
    variance = lambda * variance + (1 - lambda) * value * value;
  }

  return variance;
}
