import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { map, Observable, shareReplay } from 'rxjs';
import type {
  CalibrationResponse,
  CatalogEntry,
  EmissionsResponse,
  InstrumentResponse,
  LedgerVerifyResponse,
  LiveScoreboardResponse,
  MetaResponse,
  ScoreboardResponse,
  SearchHit,
} from './api.types';

@Injectable({ providedIn: 'root' })
export class DataService {
  private readonly http = inject(HttpClient);

  private readonly base = (() => {
    const baseUri = typeof document === 'undefined' ? '/' : document.baseURI;
    return `${baseUri.endsWith('/') ? baseUri : `${baseUri}/`}data/`;
  })();

  private readonly catalog$ = this.http
    .get<CatalogEntry[]>(`${this.base}instruments.json`)
    .pipe(shareReplay({ bufferSize: 1, refCount: false }));

  private readonly meta$ = this.http
    .get<MetaResponse>(`${this.base}meta.json`)
    .pipe(shareReplay({ bufferSize: 1, refCount: false }));

  meta(): Observable<MetaResponse> {
    return this.meta$;
  }

  catalog(): Observable<CatalogEntry[]> {
    return this.catalog$;
  }

  tracked(): Observable<CatalogEntry[]> {
    return this.catalog$.pipe(map((entries) => entries.filter((entry) => entry.isTracked)));
  }

  search(term: string, limit = 12): Observable<SearchHit[]> {
    const needle = term.trim().toLowerCase();
    return this.catalog$.pipe(
      map((entries) => {
        if (needle.length === 0) {
          return [];
        }
        return entries
          .map((entry) => ({ entry, score: scoreEntry(entry, needle) }))
          .filter((item) => item.score > 0)
          .sort(
            (a, b) =>
              b.score - a.score ||
              Number(b.entry.isTracked) - Number(a.entry.isTracked) ||
              a.entry.symbol.localeCompare(b.entry.symbol),
          )
          .slice(0, limit)
          .map((item) => ({ ...item.entry, score: item.score }));
      }),
    );
  }

  instrument(slug: string): Observable<InstrumentResponse> {
    return this.http.get<InstrumentResponse>(`${this.base}instrument/${slug}.json`);
  }

  slugFor(symbol: string): Observable<string | null> {
    const upper = symbol.toUpperCase();
    return this.catalog$.pipe(
      map((entries) => {
        const bySymbol = entries.find((entry) => entry.symbol.toUpperCase() === upper);
        if (bySymbol) {
          return bySymbol.slug;
        }
        const bySlug = entries.find((entry) => entry.slug === upper);
        return bySlug?.slug ?? null;
      }),
    );
  }

  scoreboard(): Observable<ScoreboardResponse> {
    return this.http.get<ScoreboardResponse>(`${this.base}scoreboard.json`);
  }

  liveScoreboard(): Observable<LiveScoreboardResponse> {
    return this.http.get<LiveScoreboardResponse>(`${this.base}scoreboard-live.json`);
  }

  calibration(modelKey: string): Observable<CalibrationResponse> {
    return this.http.get<CalibrationResponse>(`${this.base}calibration/${modelKey}.json`);
  }

  emissions(): Observable<EmissionsResponse> {
    return this.http.get<EmissionsResponse>(`${this.base}emissions.json`);
  }

  verifyLedger(): Observable<LedgerVerifyResponse> {
    return this.http.get<LedgerVerifyResponse>(`${this.base}ledger.json`);
  }
}

function scoreEntry(entry: CatalogEntry, needle: string): number {
  const symbol = entry.symbol.toLowerCase();
  const name = entry.name.toLowerCase();

  if (symbol === needle) {
    return 1;
  }
  if (entry.aliases.includes(needle)) {
    return 0.98;
  }
  if (symbol.startsWith(needle)) {
    return 0.9;
  }
  if (entry.aliases.some((alias) => alias.startsWith(needle))) {
    return 0.85;
  }
  if (name.includes(needle)) {
    return 0.7;
  }
  if (entry.aliases.some((alias) => alias.includes(needle))) {
    return 0.6;
  }
  if (needle.length >= 4 && closeEnough(name, needle)) {
    return 0.45;
  }
  if (needle.length >= 4 && entry.aliases.some((alias) => closeEnough(alias, needle))) {
    return 0.4;
  }
  return 0;
}

function closeEnough(candidate: string, needle: string): boolean {
  for (const token of candidate.split(/\s+/)) {
    if (Math.abs(token.length - needle.length) > 2) {
      continue;
    }
    if (editDistanceWithin(token, needle, 2)) {
      return true;
    }
  }
  return false;
}

function editDistanceWithin(a: string, b: string, limit: number): boolean {
  if (Math.abs(a.length - b.length) > limit) {
    return false;
  }

  let previous = Array.from({ length: b.length + 1 }, (_unused, index) => index);

  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        (current[j - 1] ?? 0) + 1,
        (previous[j] ?? 0) + 1,
        (previous[j - 1] ?? 0) + cost,
      );
    }
    if (Math.min(...current) > limit) {
      return false;
    }
    previous = current;
  }

  return (previous[b.length] ?? limit + 1) <= limit;
}
