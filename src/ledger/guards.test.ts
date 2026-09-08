import { describe, expect, it } from 'vitest';
import { assertEmissionTiming, LedgerRejection, MAX_LEAD_MS } from './ledger.js';
import type { TimingEscapes } from './ledger.js';
import type { PredictionDraft } from '../predictions/canonical.js';

const HOUR = 3_600_000;
const DAY = 86_400_000;

const AHORA = Date.parse('2026-09-08T04:18:00.000Z');
const SLOT_DE_HOY = new Date(Date.parse('2026-09-08T00:00:00.000Z'));
const SLOT_DE_MANANA = new Date(Date.parse('2026-09-09T00:00:00.000Z'));

function draftFor(t0: Date, horizonDays = 1): PredictionDraft {
  return {
    instrumentSymbol: 'BTCUSD',
    modelKey: 'ewmaVol',
    modelVersion: '1.0.0',
    spec: {
      type: 'MAG',
      params: { kSigma: 1, sigmaWindow: 30, thresholdAbs: 0.019 },
    },
    horizon: horizonDays === 1 ? '1d' : '7d',
    t0Utc: t0,
    windowEndUtc: new Date(t0.getTime() + horizonDays * DAY),
    probability: 0.27,
    origin: 'scheduled',
    featuresHash: 'a'.repeat(64),
  };
}

function rejectionFor(draft: PredictionDraft, escapes: TimingEscapes = {}): LedgerRejection {
  try {
    assertEmissionTiming(draft, AHORA, escapes);
  } catch (error) {
    if (error instanceof LedgerRejection) {
      return error;
    }
    throw error;
  }
  throw new Error('no se rechazo la emision');
}

describe('guarda de temporalidad de la emision', () => {
  it('rechaza el slot de hoy con el retraso exacto que provoco la averia', () => {
    expect(rejectionFor(draftFor(SLOT_DE_HOY)).message).toContain('ya se abrio');
  });

  it('rechaza un slot abierto hace un solo milisegundo', () => {
    const justoAbierto = new Date(Math.floor(AHORA / DAY) * DAY);
    const alFilo = justoAbierto.getTime() + DAY;
    expect(() => assertEmissionTiming(draftFor(new Date(alFilo)), alFilo)).toThrow(
      LedgerRejection,
    );
    expect(() => assertEmissionTiming(draftFor(new Date(alFilo)), alFilo - 1)).not.toThrow();
  });

  it('rechaza un slot a mas de 48 horas para que nadie precargue predicciones', () => {
    const lejano = new Date(Date.parse('2026-09-11T00:00:00.000Z'));
    expect(rejectionFor(draftFor(lejano)).message).toContain('no se precargan');
  });

  it('rechaza un t0 que no es medianoche exacta', () => {
    const torcido = new Date(SLOT_DE_MANANA.getTime() + 5 * 60_000);
    expect(rejectionFor(draftFor(torcido)).message).toContain('slot canonico');
  });

  it('rechaza una ventana que termina antes de empezar', () => {
    const invertida: PredictionDraft = {
      ...draftFor(SLOT_DE_MANANA),
      windowEndUtc: new Date(SLOT_DE_MANANA.getTime() - DAY),
    };
    expect(rejectionFor(invertida).message).toContain('termina antes');
  });

  it('rechaza una ventana ya cerrada', () => {
    const vieja = new Date(Date.parse('2026-09-01T00:00:00.000Z'));
    expect(rejectionFor(draftFor(vieja)).message).toContain('ya esta cerrada');
  });

  it('ACEPTA el slot de manana emitido con cuatro horas de retraso del cron', () => {
    expect(() => assertEmissionTiming(draftFor(SLOT_DE_MANANA), AHORA)).not.toThrow();
  });

  it('acepta el slot de manana a cualquier hora del dia, puntual o con horas de retraso', () => {
    for (let hour = 0; hour < 24; hour += 1) {
      const now = Date.parse(`2026-09-08T${String(hour).padStart(2, '0')}:30:00.000Z`);
      const slot = new Date(Math.floor(now / DAY) * DAY + DAY);
      expect(() => assertEmissionTiming(draftFor(slot), now)).not.toThrow();
    }
  });

  it('acepta un horizonte de 7 dias sobre el slot de manana', () => {
    expect(() => assertEmissionTiming(draftFor(SLOT_DE_MANANA, 7), AHORA)).not.toThrow();
  });

  it('el escape de simulacion admite slots pasados y es un parametro, no una variable de entorno', () => {
    const pasado = new Date(Date.parse('2026-08-09T00:00:00.000Z'));

    expect(() => assertEmissionTiming(draftFor(pasado), AHORA)).toThrow(LedgerRejection);
    expect(() =>
      assertEmissionTiming(draftFor(pasado), AHORA, {
        allowPastSlotMs: 400 * DAY,
        allowClosedWindow: true,
      }),
    ).not.toThrow();
  });

  it('mantiene la ventana maxima de antelacion en 48 horas', () => {
    expect(MAX_LEAD_MS).toBe(48 * HOUR);
  });
});
