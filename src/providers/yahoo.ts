import type { AssetClass } from '../config/index.js';
import { msToUtcDate, utcDateToMs } from '../util/dates.js';
import { fetchJson, RateLimiter } from './http.js';
import { normalizeBar } from './PriceProvider.js';
import type {
  Bar,
  BarInterval,
  BarRepair,
  InstrumentHit,
  NormalizedBars,
  PriceProvider,
} from './PriceProvider.js';

const BASE_HOSTS = ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com'];
const DAY_MS = 86_400_000;

const limiter = new RateLimiter(600);

interface ChartResponse {
  chart: {
    error: { code: string; description: string } | null;
    result:
      | Array<{
          meta: { currency?: string; exchangeName?: string; symbol?: string };
          timestamp?: number[];
          indicators: {
            quote?: Array<{
              open?: Array<number | null>;
              high?: Array<number | null>;
              low?: Array<number | null>;
              close?: Array<number | null>;
              volume?: Array<number | null>;
            }>;
            adjclose?: Array<{ adjclose?: Array<number | null> }>;
          };
        }>
      | null;
  };
}

interface SearchResponse {
  quotes?: Array<{
    symbol?: string;
    shortname?: string;
    longname?: string;
    quoteType?: string;
    exchange?: string;
    exchDisp?: string;
  }>;
}

const QUOTE_TYPE_MAP: Record<string, AssetClass> = {
  EQUITY: 'equity',
  ETF: 'etf',
  INDEX: 'index',
  CRYPTOCURRENCY: 'crypto',
  CURRENCY: 'fx',
};

export const yahooProvider: PriceProvider = {
  key: 'yahoo',
  supportsSearch: true,

  async fetchBars(
    providerSymbol: string,
    interval: BarInterval,
    fromDate: string,
    toDate: string,
  ): Promise<NormalizedBars> {
    if (interval !== '1d') {
      throw new Error(`yahoo: intervalo no soportado ${interval}`);
    }

    const period1 = Math.floor(utcDateToMs(fromDate) / 1000);
    const period2 = Math.floor((utcDateToMs(toDate) + DAY_MS) / 1000);
    const path =
      `/v8/finance/chart/${encodeURIComponent(providerSymbol)}` +
      `?period1=${period1}&period2=${period2}&interval=1d&includeAdjustedClose=true`;

    const payload = await fetchAcrossHosts<ChartResponse>(path);

    if (payload.chart.error) {
      throw new Error(`yahoo: ${payload.chart.error.code} ${payload.chart.error.description}`);
    }

    const result = payload.chart.result?.[0];
    if (!result) {
      throw new Error(`yahoo: respuesta sin datos para ${providerSymbol}`);
    }

    const timestamps = result.timestamp ?? [];
    const quote = result.indicators.quote?.[0];
    const adjcloseSeries = result.indicators.adjclose?.[0]?.adjclose;

    if (!quote) {
      throw new Error(`yahoo: respuesta sin indicadores para ${providerSymbol}`);
    }

    const bars: Bar[] = [];
    const repairs: BarRepair[] = [];

    for (let index = 0; index < timestamps.length; index += 1) {
      const timestamp = timestamps[index];
      const open = quote.open?.[index];
      const high = quote.high?.[index];
      const low = quote.low?.[index];
      const close = quote.close?.[index];

      if (timestamp === undefined || open == null || high == null || low == null || close == null) {
        continue;
      }

      const adjClose = adjcloseSeries?.[index] ?? close;
      const volume = quote.volume?.[index] ?? null;

      const normalized = normalizeBar(
        {
          barDate: msToUtcDate(timestamp * 1000),
          open: round8(open),
          high: round8(high),
          low: round8(low),
          close: round8(close),
          adjClose: round8(adjClose ?? close),
          volume: volume == null ? null : round8(volume),
        },
        providerSymbol,
      );
      bars.push(normalized.bar);
      repairs.push(...normalized.repairs);
    }

    const today = msToUtcDate(Date.now());
    return { bars: bars.filter((bar) => bar.barDate < today), repairs };
  },

  async searchSymbols(query: string): Promise<InstrumentHit[]> {
    const path =
      `/v1/finance/search?q=${encodeURIComponent(query)}` +
      `&quotesCount=12&newsCount=0&listsCount=0`;

    const payload = await fetchAcrossHosts<SearchResponse>(path);
    const hits: InstrumentHit[] = [];

    for (const quote of payload.quotes ?? []) {
      const symbol = quote.symbol;
      const quoteType = quote.quoteType;
      if (!symbol || !quoteType) {
        continue;
      }
      const assetClass = QUOTE_TYPE_MAP[quoteType];
      if (!assetClass) {
        continue;
      }
      hits.push({
        providerSymbol: symbol,
        name: quote.longname ?? quote.shortname ?? symbol,
        assetClass,
        exchange: quote.exchDisp ?? quote.exchange ?? null,
        currency: 'USD',
      });
    }

    return hits;
  },
};

async function fetchAcrossHosts<T>(path: string): Promise<T> {
  let lastError: unknown = null;
  for (const host of BASE_HOSTS) {
    try {
      return await fetchJson<T>(`${host}${path}`, { limiter, attempts: 2 });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`yahoo: todos los hosts fallaron para ${path}`);
}

function round8(value: number): number {
  return Math.round(value * 1e8) / 1e8;
}
