import { describe, expect, it } from 'vitest';
import {
  buildCanonicalPrediction,
  canonicalJson,
  formatProbability,
  hashFeatures,
} from './canonical.js';
import type { PredictionDraft } from './canonical.js';
import type { EventSpec } from './events.js';

const magSpec: EventSpec = {
  type: 'MAG',
  params: { kSigma: 1.5, sigmaWindow: 30, thresholdAbs: 0.073412 },
};

function draft(overrides: Partial<PredictionDraft> = {}): PredictionDraft {
  return {
    instrumentSymbol: 'BTCUSD',
    modelKey: 'ewmaVol',
    modelVersion: '1.0.0',
    spec: magSpec,
    horizon: '7d',
    t0Utc: new Date('2026-09-07T00:00:00.000Z'),
    windowEndUtc: new Date('2026-09-14T00:00:00.000Z'),
    probability: 0.35,
    origin: 'scheduled',
    featuresHash: 'a'.repeat(64),
    ...overrides,
  };
}

describe('canonicalJson', () => {
  it('ordena las claves de forma estable', () => {
    expect(canonicalJson({ b: '2', a: '1', c: '3' })).toBe('{"a":"1","b":"2","c":"3"}');
  });

  it('produce el mismo texto sea cual sea el orden de insercion', () => {
    const first = canonicalJson({ z: '1', a: { y: '2', b: '3' } });
    const second = canonicalJson({ a: { b: '3', y: '2' }, z: '1' });
    expect(first).toBe(second);
  });

  it('escapa correctamente y no produce espacios', () => {
    expect(canonicalJson({ 'a b': 'c"d' })).toBe('{"a b":"c\\"d"}');
  });
});

describe('formatProbability', () => {
  it('usa siempre 5 decimales', () => {
    expect(formatProbability(0.35)).toBe('0.35000');
    expect(formatProbability(0.5)).toBe('0.50000');
    expect(formatProbability(0.123456789)).toBe('0.12346');
  });

  it('rechaza certezas', () => {
    expect(() => formatProbability(0)).toThrow(/fuera de rango/);
    expect(() => formatProbability(1)).toThrow(/fuera de rango/);
    expect(() => formatProbability(0.0009)).toThrow(/fuera de rango/);
  });

  it('rechaza valores no finitos', () => {
    expect(() => formatProbability(Number.NaN)).toThrow(/no finita/);
    expect(() => formatProbability(Number.POSITIVE_INFINITY)).toThrow(/no finita/);
  });
});

describe('buildCanonicalPrediction', () => {
  it('es determinista byte a byte en 1000 ejecuciones', () => {
    const hashes = new Set<string>();
    const payloads = new Set<string>();
    for (let index = 0; index < 1000; index += 1) {
      const result = buildCanonicalPrediction(draft());
      hashes.add(result.contentHash);
      payloads.add(result.payload);
    }
    expect(hashes.size).toBe(1);
    expect(payloads.size).toBe(1);
  });

  it('no deja ningun float en el payload', () => {
    const { payload } = buildCanonicalPrediction(draft());
    const parsed: unknown = JSON.parse(payload);
    const walk = (node: unknown): void => {
      if (typeof node === 'number') {
        throw new Error('el payload contiene un numero en crudo');
      }
      if (node !== null && typeof node === 'object') {
        Object.values(node).forEach(walk);
      }
    };
    expect(() => walk(parsed)).not.toThrow();
  });

  it('cambia el hash si cambia la probabilidad en el quinto decimal', () => {
    const a = buildCanonicalPrediction(draft({ probability: 0.35 }));
    const b = buildCanonicalPrediction(draft({ probability: 0.35001 }));
    expect(a.contentHash).not.toBe(b.contentHash);
  });

  it('cambia el hash si cambia el umbral absoluto', () => {
    const a = buildCanonicalPrediction(draft());
    const b = buildCanonicalPrediction(
      draft({
        spec: { type: 'MAG', params: { kSigma: 1.5, sigmaWindow: 30, thresholdAbs: 0.073413 } },
      }),
    );
    expect(a.contentHash).not.toBe(b.contentHash);
  });

  it('cambia el hash si cambia la version del modelo', () => {
    const a = buildCanonicalPrediction(draft());
    const b = buildCanonicalPrediction(draft({ modelVersion: '1.0.1' }));
    expect(a.contentHash).not.toBe(b.contentHash);
  });

  it('incluye la version de esquema', () => {
    const { payload } = buildCanonicalPrediction(draft());
    expect(payload).toContain('"schemaVersion":"1"');
  });
});

describe('hashFeatures', () => {
  it('es sensible al ultimo decimal del precio', () => {
    const a = hashFeatures([{ barDate: '2026-09-01', adjClose: 100.00000001 }]);
    const b = hashFeatures([{ barDate: '2026-09-01', adjClose: 100.00000002 }]);
    expect(a).not.toBe(b);
  });

  it('es sensible al orden de las barras', () => {
    const a = hashFeatures([
      { barDate: '2026-09-01', adjClose: 100 },
      { barDate: '2026-09-02', adjClose: 101 },
    ]);
    const b = hashFeatures([
      { barDate: '2026-09-02', adjClose: 101 },
      { barDate: '2026-09-01', adjClose: 100 },
    ]);
    expect(a).not.toBe(b);
  });

  it('rechaza un conjunto vacio', () => {
    expect(() => hashFeatures([])).toThrow(/vacio/);
  });
});
