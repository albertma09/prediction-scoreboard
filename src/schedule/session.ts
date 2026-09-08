import type { AssetClass } from '../config/index.js';
import { addDaysUtc, msToUtcDate, utcDateToMs } from '../util/dates.js';
import type { Horizon } from '../predictions/events.js';

export function isWeekendUtc(date: string): boolean {
  const day = new Date(utcDateToMs(date)).getUTCDay();
  return day === 0 || day === 6;
}

export function tradesAroundTheClock(assetClass: AssetClass): boolean {
  return assetClass === 'crypto';
}

export function windowCanHaveSession(
  assetClass: AssetClass,
  t0Date: string,
  horizon: Horizon,
): boolean {
  if (tradesAroundTheClock(assetClass)) {
    return true;
  }

  const days = horizon === '1d' ? 1 : 7;
  for (let offset = 0; offset < days; offset += 1) {
    if (!isWeekendUtc(addDaysUtc(t0Date, offset))) {
      return true;
    }
  }

  return false;
}

const DAY_MS = 86_400_000;

export function currentSlotUtc(now = Date.now()): Date {
  return new Date(Math.floor(now / DAY_MS) * DAY_MS);
}

export function nextSlotUtc(now = Date.now()): Date {
  return new Date(Math.floor(now / DAY_MS) * DAY_MS + DAY_MS);
}

export function historyCutoffUtc(now = Date.now()): string {
  return msToUtcDate(Math.floor(now / DAY_MS) * DAY_MS);
}

export function slotDateOf(slot: Date): string {
  return slot.toISOString().slice(0, 10);
}

export function minutesUntilSlot(slot: Date, now = Date.now()): number {
  return Math.round((slot.getTime() - now) / 60_000);
}

export function minutesLate(slot: Date, now = Date.now()): number {
  return Math.max(0, Math.round((now - slot.getTime()) / 60_000));
}
