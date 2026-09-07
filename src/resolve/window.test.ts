import { describe, expect, it } from 'vitest';
import { attemptResolution, minimumVolBars, selectWindow } from './window.js';
import type { WindowBar } from './window.js';
import type { EventSpec } from '../predictions/events.js';

function bars(entries: Array<[string, number]>): WindowBar[] {
  return entries.map(([barDate, adjClose]) => ({ barDate, adjClose }));
}

const CRYPTO_WEEK = bars([
  ['2026-09-01', 100],
  ['2026-09-02', 101],
  ['2026-09-03', 99],
  ['2026-09-04', 104],
  ['2026-09-05', 103],
  ['2026-09-06', 108],
  ['2026-09-07', 107],
  ['2026-09-08', 110],
]);

const CRYPTO_FULL_WEEK = bars([
  ['2026-08-31', 98],
  ['2026-09-01', 100],
  ['2026-09-02', 101],
  ['2026-09-03', 99],
  ['2026-09-04', 104],
  ['2026-09-05', 103],
  ['2026-09-06', 108],
  ['2026-09-07', 107],
]);

describe('selectWindow', () => {
  it('la barra base es la ultima anterior a t0', () => {
    const { baseBar } = selectWindow(CRYPTO_WEEK, '2026-09-04', '2026-09-08');
    expect(baseBar?.barDate).toBe('2026-09-03');
  });

  it('la ventana excluye la fecha de cierre', () => {
    const { windowBars } = selectWindow(CRYPTO_WEEK, '2026-09-04', '2026-09-08');
    expect(windowBars.map((bar) => bar.barDate)).toEqual([
      '2026-09-04',
      '2026-09-05',
      '2026-09-06',
      '2026-09-07',
    ]);
  });

  it('una ventana de 1 dia contiene exactamente una barra', () => {
    const { windowBars } = selectWindow(CRYPTO_WEEK, '2026-09-04', '2026-09-05');
    expect(windowBars.map((bar) => bar.barDate)).toEqual(['2026-09-04']);
  });

  it('no hay barra base si todo el historial es posterior a t0', () => {
    const { baseBar } = selectWindow(CRYPTO_WEEK, '2026-09-01', '2026-09-05');
    expect(baseBar).toBeNull();
  });
});

describe('minimumVolBars', () => {
  it('exige el 60% de las barras esperadas', () => {
    expect(minimumVolBars('crypto', '7d')).toBe(5);
    expect(minimumVolBars('equity', '7d')).toBe(3);
    expect(minimumVolBars('crypto', '1d')).toBe(1);
  });
});

describe('attemptResolution: casos nulos', () => {
  const dir: EventSpec = { type: 'DIR', params: {} };

  it('anula si no hay barra base', () => {
    const attempt = attemptResolution(dir, 'crypto', '1d', CRYPTO_WEEK, '2026-09-01', '2026-09-02');
    expect(attempt.outcome).toBeNull();
    expect(attempt.voidReason).toBe('no_base_bar');
  });

  it('anula si la ventana esta vacia', () => {
    const weekend = bars([
      ['2026-09-04', 100],
      ['2026-09-07', 102],
    ]);
    const attempt = attemptResolution(dir, 'equity', '1d', weekend, '2026-09-05', '2026-09-06');
    expect(attempt.voidReason).toBe('no_bars_in_window');
  });

  it('anula un VOL con barras insuficientes', () => {
    const vol: EventSpec = { type: 'VOL', params: { rvPrevious: 0.01, windowBars: 7 } };
    const sparse = bars([
      ['2026-09-03', 100],
      ['2026-09-04', 101],
      ['2026-09-05', 102],
    ]);
    const attempt = attemptResolution(vol, 'crypto', '7d', sparse, '2026-09-04', '2026-09-11');
    expect(attempt.voidReason).toBe('insufficient_vol_bars');
  });

  it('un MAG con una sola barra si se resuelve', () => {
    const mag: EventSpec = {
      type: 'MAG',
      params: { kSigma: 1, sigmaWindow: 30, thresholdAbs: 0.01 },
    };
    const sparse = bars([
      ['2026-09-03', 100],
      ['2026-09-04', 105],
    ]);
    const attempt = attemptResolution(mag, 'equity', '7d', sparse, '2026-09-04', '2026-09-11');
    expect(attempt.voidReason).toBeNull();
    expect(attempt.outcome).toBe(1);
  });
});

describe('attemptResolution: resultados', () => {
  it('DIR acierta con retorno positivo de base a final', () => {
    const dir: EventSpec = { type: 'DIR', params: {} };
    const attempt = attemptResolution(dir, 'crypto', '7d', CRYPTO_WEEK, '2026-09-04', '2026-09-08');
    expect(attempt.inputs.baseBar?.adjClose).toBe(99);
    expect(attempt.inputs.endBar?.adjClose).toBe(107);
    expect(attempt.outcome).toBe(1);
  });

  it('MAG usa el umbral congelado, no recalcula sigma', () => {
    const tight: EventSpec = {
      type: 'MAG',
      params: { kSigma: 1, sigmaWindow: 30, thresholdAbs: 0.05 },
    };
    const wide: EventSpec = {
      type: 'MAG',
      params: { kSigma: 1, sigmaWindow: 30, thresholdAbs: 0.5 },
    };

    expect(
      attemptResolution(tight, 'crypto', '7d', CRYPTO_WEEK, '2026-09-04', '2026-09-08').outcome,
    ).toBe(1);
    expect(
      attemptResolution(wide, 'crypto', '7d', CRYPTO_WEEK, '2026-09-04', '2026-09-08').outcome,
    ).toBe(0);
  });

  it('VOL compara contra el rvPrevious congelado', () => {
    const easy: EventSpec = { type: 'VOL', params: { rvPrevious: 0.001, windowBars: 7 } };
    const hard: EventSpec = { type: 'VOL', params: { rvPrevious: 0.5, windowBars: 7 } };

    const easyAttempt = attemptResolution(
      easy, 'crypto', '7d', CRYPTO_FULL_WEEK, '2026-09-01', '2026-09-08',
    );
    const hardAttempt = attemptResolution(
      hard, 'crypto', '7d', CRYPTO_FULL_WEEK, '2026-09-01', '2026-09-08',
    );

    expect(easyAttempt.voidReason).toBeNull();
    expect(easyAttempt.inputs.windowBars).toHaveLength(7);
    expect(easyAttempt.outcome).toBe(1);
    expect(hardAttempt.outcome).toBe(0);
  });

  it('el numero de log-retornos iguala el numero de barras de la ventana', () => {
    const dir: EventSpec = { type: 'DIR', params: {} };
    const attempt = attemptResolution(dir, 'crypto', '7d', CRYPTO_WEEK, '2026-09-04', '2026-09-08');
    expect(attempt.inputs.windowLogReturns).toHaveLength(attempt.inputs.windowBars.length);
  });

  it('registra el retorno simple exacto usado', () => {
    const dir: EventSpec = { type: 'DIR', params: {} };
    const attempt = attemptResolution(dir, 'crypto', '7d', CRYPTO_WEEK, '2026-09-04', '2026-09-08');
    expect(attempt.inputs.simpleReturn).toBeCloseTo(107 / 99 - 1, 12);
  });
});
