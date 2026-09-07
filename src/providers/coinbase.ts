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

const BASE_URL = 'https://api.exchange.coinbase.com';
const DAY_MS = 86_400_000;
const MAX_CANDLES = 300;

type Candle = [number, number, number, number, number, number];

const limiter = new RateLimiter(180);

export const coinbaseProvider: PriceProvider = {
  key: 'coinbase',
  supportsSearch: false,

  async fetchBars(
    providerSymbol: string,
    interval: BarInterval,
    fromDate: string,
    toDate: string,
  ): Promise<NormalizedBars> {
    if (interval !== '1d') {
      throw new Error(`coinbase: intervalo no soportado ${interval}`);
    }

    const fromMs = utcDateToMs(fromDate);
    const toMs = utcDateToMs(toDate);
    const byDate = new Map<string, Bar>();
    const repairs: BarRepair[] = [];

    let windowEnd = toMs;

    while (windowEnd > fromMs) {
      const windowStart = Math.max(fromMs, windowEnd - (MAX_CANDLES - 1) * DAY_MS);
      const url =
        `${BASE_URL}/products/${encodeURIComponent(providerSymbol)}/candles` +
        `?granularity=86400&start=${new Date(windowStart).toISOString()}` +
        `&end=${new Date(windowEnd).toISOString()}`;

      const page = await fetchJson<Candle[]>(url, { limiter });

      if (!Array.isArray(page) || page.length === 0) {
        break;
      }

      for (const candle of page) {
        const normalized = normalizeBar(
          {
            barDate: msToUtcDate(candle[0] * 1000),
            open: candle[3],
            high: candle[2],
            low: candle[1],
            close: candle[4],
            adjClose: candle[4],
            volume: candle[5],
          },
          providerSymbol,
        );
        byDate.set(normalized.bar.barDate, normalized.bar);
        repairs.push(...normalized.repairs);
      }

      windowEnd = windowStart - DAY_MS;
    }

    const today = msToUtcDate(Date.now());
    const bars = [...byDate.values()]
      .filter((bar) => bar.barDate < today)
      .sort((a, b) => a.barDate.localeCompare(b.barDate));

    return { bars, repairs };
  },

  async searchSymbols(): Promise<InstrumentHit[]> {
    return [];
  },
};
