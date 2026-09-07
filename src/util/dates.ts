const DAY_MS = 86_400_000;

export function msToUtcDate(ms: number): string {
  const iso = new Date(ms).toISOString();
  return iso.slice(0, 10);
}

export function utcDateToMs(date: string): number {
  const ms = Date.parse(`${date}T00:00:00.000Z`);
  if (Number.isNaN(ms)) {
    throw new Error(`fecha invalida: ${date}`);
  }
  return ms;
}

export function addDaysUtc(date: string, days: number): string {
  return msToUtcDate(utcDateToMs(date) + days * DAY_MS);
}

export function todayUtc(): string {
  return msToUtcDate(Date.now());
}

export function yearsAgoUtc(years: number): string {
  const now = new Date();
  const past = new Date(
    Date.UTC(now.getUTCFullYear() - years, now.getUTCMonth(), now.getUTCDate()),
  );
  return past.toISOString().slice(0, 10);
}

export function daysBetweenUtc(from: string, to: string): number {
  return Math.round((utcDateToMs(to) - utcDateToMs(from)) / DAY_MS);
}
