import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { categorySchema, fallbackCategory, instrumentSeedSchema } from './catalog.js';

const here = dirname(fileURLToPath(import.meta.url));
const seedPath = join(here, '..', '..', 'data', 'seed-instruments.json');
const raw: unknown = JSON.parse(readFileSync(seedPath, 'utf8'));
const seeds = z.array(instrumentSeedSchema).parse(raw);

describe('catalogo sembrado', () => {
  it('valida entero contra el esquema', () => {
    expect(seeds.length).toBeGreaterThan(0);
  });

  it('no repite simbolos', () => {
    const symbols = seeds.map((seed) => seed.symbol);
    expect(new Set(symbols).size).toBe(symbols.length);
  });

  it('da categoria a todos los instrumentos', () => {
    for (const seed of seeds) {
      expect(categorySchema.safeParse(seed.category).success).toBe(true);
    }
  });

  it('reparte los instrumentos entre las categorias sin perder ninguno', () => {
    const counts = new Map<string, number>();
    for (const seed of seeds) {
      counts.set(seed.category, (counts.get(seed.category) ?? 0) + 1);
    }

    const total = [...counts.values()].reduce((sum, n) => sum + n, 0);
    expect(total).toBe(seeds.length);

    for (const category of categorySchema.options) {
      expect(counts.get(category) ?? 0).toBeGreaterThan(0);
    }
  });

  it('mantiene assetClass y category desacopladas: una materia prima sigue siendo un ETF', () => {
    const commodities = seeds.filter((seed) => seed.category === 'commodity');
    expect(commodities.length).toBeGreaterThan(0);

    for (const seed of commodities) {
      expect(seed.assetClass).toBe('etf');
    }
  });

  it('no inventa clases de activo: category nunca cambia el calendario de resolucion', () => {
    for (const seed of seeds) {
      if (seed.category === 'crypto') {
        expect(seed.assetClass).toBe('crypto');
      }
      if (seed.category === 'equity') {
        expect(seed.assetClass).toBe('equity');
      }
      if (seed.category === 'index') {
        expect(seed.assetClass).toBe('index');
      }
    }
  });

  it('deja los instrumentos trackeados con una categoria util', () => {
    const tracked = seeds.filter((seed) => seed.tracked);
    expect(tracked.length).toBeGreaterThan(0);
    for (const seed of tracked) {
      expect(categorySchema.options).toContain(seed.category);
    }
  });

  it('el universo puntuable abarca varias categorias, no una sola repetida', () => {
    const tracked = seeds.filter((seed) => seed.tracked);
    const categorias = new Set(tracked.map((seed) => seed.category));

    expect(categorias.size).toBeGreaterThanOrEqual(3);
  });

  it('ninguna categoria domina el universo puntuable por encima de la mitad', () => {
    const tracked = seeds.filter((seed) => seed.tracked);
    const cuenta = new Map<string, number>();
    for (const seed of tracked) {
      cuenta.set(seed.category, (cuenta.get(seed.category) ?? 0) + 1);
    }

    for (const [, n] of cuenta) {
      expect(n / tracked.length).toBeLessThanOrEqual(0.5);
    }
  });

  it('el universo puntuable mezcla activos que cotizan 24/7 con activos con sesion', () => {
    const tracked = seeds.filter((seed) => seed.tracked);
    const continuos = tracked.filter((seed) => seed.assetClass === 'crypto').length;

    expect(continuos).toBeGreaterThan(0);
    expect(tracked.length - continuos).toBeGreaterThan(0);
  });
});

describe('fallbackCategory', () => {
  it('respeta la clase cuando existe como categoria', () => {
    expect(fallbackCategory('crypto')).toBe('crypto');
    expect(fallbackCategory('equity')).toBe('equity');
    expect(fallbackCategory('etf')).toBe('etf');
    expect(fallbackCategory('index')).toBe('index');
  });

  it('coloca fx bajo etf porque no es una categoria propia del catalogo', () => {
    expect(fallbackCategory('fx')).toBe('etf');
  });

  it('nunca devuelve commodity: eso solo se declara a mano en la semilla', () => {
    const classes = ['crypto', 'equity', 'etf', 'index', 'fx'] as const;
    for (const assetClass of classes) {
      expect(fallbackCategory(assetClass)).not.toBe('commodity');
    }
  });
});
