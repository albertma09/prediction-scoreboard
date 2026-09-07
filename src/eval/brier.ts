export interface ScoredPrediction {
  probability: number;
  outcome: 0 | 1;
}

export interface PairedScore {
  modelProbability: number;
  baselineProbability: number;
  outcome: 0 | 1;
}

export interface CalibrationBin {
  lowerBound: number;
  upperBound: number;
  count: number;
  meanForecast: number;
  observedFrequency: number;
}

export interface MurphyDecomposition {
  brier: number;
  reliability: number;
  resolution: number;
  uncertainty: number;
}

export function brierScore(probability: number, outcome: 0 | 1): number {
  if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
    throw new Error(`probabilidad invalida: ${probability}`);
  }
  return (probability - outcome) ** 2;
}

export function meanBrier(items: readonly ScoredPrediction[]): number {
  if (items.length === 0) {
    throw new Error('no se puede promediar el Brier de un conjunto vacio');
  }
  const total = items.reduce(
    (sum, item) => sum + brierScore(item.probability, item.outcome),
    0,
  );
  return total / items.length;
}

export function baseRate(items: readonly ScoredPrediction[]): number {
  if (items.length === 0) {
    throw new Error('no se puede calcular la tasa base de un conjunto vacio');
  }
  return items.reduce((sum, item) => sum + item.outcome, 0) / items.length;
}

export function brierSkillScore(modelBrier: number, baselineBrier: number): number {
  if (baselineBrier <= 0) {
    throw new Error(
      'el Brier del baseline es 0: el baseline es perfecto y el skill score no esta definido',
    );
  }
  return 1 - modelBrier / baselineBrier;
}

export function pooledSkillScore(items: readonly PairedScore[]): number {
  if (items.length === 0) {
    throw new Error('no se puede calcular el skill score de un conjunto vacio');
  }

  const model = meanBrier(
    items.map((item) => ({ probability: item.modelProbability, outcome: item.outcome })),
  );
  const baseline = meanBrier(
    items.map((item) => ({ probability: item.baselineProbability, outcome: item.outcome })),
  );

  return brierSkillScore(model, baseline);
}

export function calibrationBins(
  items: readonly ScoredPrediction[],
  binCount = 10,
): CalibrationBin[] {
  if (binCount < 2) {
    throw new Error('la curva de calibracion necesita al menos 2 bins');
  }

  const buckets: ScoredPrediction[][] = Array.from({ length: binCount }, () => []);

  for (const item of items) {
    const rawIndex = Math.floor(item.probability * binCount);
    const index = Math.min(binCount - 1, Math.max(0, rawIndex));
    buckets[index]?.push(item);
  }

  return buckets.map((bucket, index) => {
    const lowerBound = index / binCount;
    const upperBound = (index + 1) / binCount;

    if (bucket.length === 0) {
      return { lowerBound, upperBound, count: 0, meanForecast: 0, observedFrequency: 0 };
    }

    const meanForecast =
      bucket.reduce((sum, item) => sum + item.probability, 0) / bucket.length;
    const observedFrequency =
      bucket.reduce((sum, item) => sum + item.outcome, 0) / bucket.length;

    return { lowerBound, upperBound, count: bucket.length, meanForecast, observedFrequency };
  });
}

export function murphyDecomposition(items: readonly ScoredPrediction[]): MurphyDecomposition {
  if (items.length === 0) {
    throw new Error('no se puede descomponer un conjunto vacio');
  }

  const overall = baseRate(items);
  const groups = new Map<string, ScoredPrediction[]>();

  for (const item of items) {
    const key = item.probability.toFixed(10);
    const group = groups.get(key);
    if (group) {
      group.push(item);
    } else {
      groups.set(key, [item]);
    }
  }

  let reliability = 0;
  let resolution = 0;

  for (const group of groups.values()) {
    const weight = group.length / items.length;
    const forecast = group[0]?.probability ?? 0;
    const observed = baseRate(group);
    reliability += weight * (forecast - observed) ** 2;
    resolution += weight * (observed - overall) ** 2;
  }

  return {
    brier: meanBrier(items),
    reliability,
    resolution,
    uncertainty: overall * (1 - overall),
  };
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface BootstrapInterval {
  point: number;
  lower: number;
  upper: number;
  iterations: number;
  blockSize: number;
}

export function blockBootstrapSkillScore(
  items: readonly PairedScore[],
  options: {
    blockSize?: number;
    iterations?: number;
    seed?: number;
    confidence?: number;
  } = {},
): BootstrapInterval {
  const blockSize = Math.max(1, options.blockSize ?? 1);
  const iterations = options.iterations ?? 2000;
  const confidence = options.confidence ?? 0.95;
  const random = mulberry32(options.seed ?? 20260907);

  if (items.length < blockSize) {
    throw new Error(
      `no hay suficientes observaciones (${items.length}) para bloques de ${blockSize}`,
    );
  }

  const point = pooledSkillScore(items);
  const blockStarts = items.length - blockSize + 1;
  const blocksNeeded = Math.ceil(items.length / blockSize);
  const samples: number[] = [];

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const resampled: PairedScore[] = [];
    for (let block = 0; block < blocksNeeded; block += 1) {
      const start = Math.floor(random() * blockStarts);
      for (let offset = 0; offset < blockSize; offset += 1) {
        const item = items[start + offset];
        if (item !== undefined) {
          resampled.push(item);
        }
      }
    }

    const trimmed = resampled.slice(0, items.length);
    try {
      samples.push(pooledSkillScore(trimmed));
    } catch {
      continue;
    }
  }

  if (samples.length === 0) {
    throw new Error('el bootstrap no produjo ninguna muestra valida');
  }

  samples.sort((a, b) => a - b);
  const alpha = (1 - confidence) / 2;

  return {
    point,
    lower: percentile(samples, alpha),
    upper: percentile(samples, 1 - alpha),
    iterations: samples.length,
    blockSize,
  };
}

function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) {
    throw new Error('percentil de un conjunto vacio');
  }
  const position = fraction * (sorted.length - 1);
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = sorted[lowerIndex];
  const upper = sorted[upperIndex];

  if (lower === undefined || upper === undefined) {
    throw new Error('indice de percentil fuera de rango');
  }

  if (lowerIndex === upperIndex) {
    return lower;
  }

  const weight = position - lowerIndex;
  return lower * (1 - weight) + upper * weight;
}
