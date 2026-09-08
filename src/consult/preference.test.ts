import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MODEL_PREFERENCE,
  MODEL_PREFERENCE_BY_EVENT,
  preferredRow,
} from './preference.js';

interface Row {
  model_key: string;
  event_type: string;
}

function rowsFor(eventType: string, modelKeys: string[]): Row[] {
  return modelKeys.map((model_key) => ({ model_key, event_type: eventType }));
}

describe('preferredRow', () => {
  it('en volatilidad elige volCal por delante de ewmaVol', () => {
    const rows = rowsFor('VOL', ['climatology', 'coinflip', 'ewmaVol', 'volCal']);
    expect(preferredRow(rows)?.model_key).toBe('volCal');
  });

  it('en magnitud elige ewmaVol, nunca volCal', () => {
    const rows = rowsFor('MAG', ['climatology', 'coinflip', 'ewmaVol']);
    expect(preferredRow(rows)?.model_key).toBe('ewmaVol');
    expect(MODEL_PREFERENCE_BY_EVENT['MAG']).not.toContain('volCal');
  });

  it('en direccion elige climatology: ningun modelo tiene habilidad medida', () => {
    const rows = rowsFor('DIR', ['coinflip', 'climatology']);
    expect(preferredRow(rows)?.model_key).toBe('climatology');
  });

  it('nunca elige coinflip', () => {
    for (const order of [...Object.values(MODEL_PREFERENCE_BY_EVENT), DEFAULT_MODEL_PREFERENCE]) {
      expect(order).not.toContain('coinflip');
    }
    expect(preferredRow(rowsFor('VOL', ['coinflip']))).toBeUndefined();
  });

  it('cae a ewmaVol si volCal no emitio', () => {
    const rows = rowsFor('VOL', ['climatology', 'ewmaVol']);
    expect(preferredRow(rows)?.model_key).toBe('ewmaVol');
  });

  it('cae a climatology si solo esta ella', () => {
    expect(preferredRow(rowsFor('VOL', ['climatology']))?.model_key).toBe('climatology');
  });

  it('devuelve undefined con una lista vacia', () => {
    expect(preferredRow([])).toBeUndefined();
  });

  it('usa el orden por defecto para un evento desconocido', () => {
    const rows = rowsFor('NUEVO', ['climatology', 'ewmaVol']);
    expect(preferredRow(rows)?.model_key).toBe('ewmaVol');
  });

  it('respeta el orden declarado y no el orden de las filas', () => {
    const rows = rowsFor('VOL', ['volCal', 'ewmaVol']);
    const reversed = rowsFor('VOL', ['ewmaVol', 'volCal']);
    expect(preferredRow(rows)?.model_key).toBe('volCal');
    expect(preferredRow(reversed)?.model_key).toBe('volCal');
  });
});
