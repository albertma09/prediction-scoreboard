import { describe, expect, it } from 'vitest';
import {
  currentSlotUtc,
  isWeekendUtc,
  minutesLate,
  slotDateOf,
  windowCanHaveSession,
} from './session.js';

describe('isWeekendUtc', () => {
  it('reconoce sabado y domingo', () => {
    expect(isWeekendUtc('2026-09-05')).toBe(true);
    expect(isWeekendUtc('2026-09-06')).toBe(true);
  });

  it('reconoce dias de semana', () => {
    for (const date of ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11']) {
      expect(isWeekendUtc(date)).toBe(false);
    }
  });
});

describe('windowCanHaveSession', () => {
  it('cripto siempre puede, incluso en domingo', () => {
    expect(windowCanHaveSession('crypto', '2026-09-06', '1d')).toBe(true);
    expect(windowCanHaveSession('crypto', '2026-09-06', '7d')).toBe(true);
  });

  it('bolsa a 1 dia no puede en sabado ni domingo', () => {
    expect(windowCanHaveSession('equity', '2026-09-05', '1d')).toBe(false);
    expect(windowCanHaveSession('equity', '2026-09-06', '1d')).toBe(false);
    expect(windowCanHaveSession('etf', '2026-09-05', '1d')).toBe(false);
  });

  it('bolsa a 1 dia si puede en dia de semana', () => {
    expect(windowCanHaveSession('equity', '2026-09-07', '1d')).toBe(true);
  });

  it('bolsa a 7 dias siempre incluye dias de semana', () => {
    for (const date of ['2026-09-05', '2026-09-06', '2026-09-07']) {
      expect(windowCanHaveSession('equity', date, '7d')).toBe(true);
    }
  });
});

describe('currentSlotUtc y slotDateOf', () => {
  it('trunca a medianoche UTC exacta', () => {
    const slot = currentSlotUtc(Date.parse('2026-09-07T14:37:22.451Z'));
    expect(slot.toISOString()).toBe('2026-09-07T00:00:00.000Z');
    expect(slot.getTime() % 86_400_000).toBe(0);
  });

  it('el slot de las 23:59 sigue siendo el de ese dia', () => {
    expect(slotDateOf(currentSlotUtc(Date.parse('2026-09-07T23:59:59.999Z')))).toBe('2026-09-07');
  });

  it('el slot de las 00:00:00 es el de ese mismo dia', () => {
    expect(slotDateOf(currentSlotUtc(Date.parse('2026-09-07T00:00:00.000Z')))).toBe('2026-09-07');
  });
});

describe('minutesLate', () => {
  it('cuenta los minutos desde la apertura del slot', () => {
    const slot = new Date('2026-09-07T00:00:00.000Z');
    expect(minutesLate(slot, Date.parse('2026-09-07T00:05:00.000Z'))).toBe(5);
    expect(minutesLate(slot, Date.parse('2026-09-07T00:44:00.000Z'))).toBe(44);
  });

  it('nunca es negativo', () => {
    const slot = new Date('2026-09-07T00:00:00.000Z');
    expect(minutesLate(slot, Date.parse('2026-09-06T23:00:00.000Z'))).toBe(0);
  });
});
