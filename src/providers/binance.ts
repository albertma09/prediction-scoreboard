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

const BASE_URL = 'https://api.binance.com';
const MAX_LIMIT = 1000;
const DAY_MS = 86_400_000;

type Kline = [number, string, string, string, string, string, number, ...unknown[]];

const limiter = new RateLimiter(250);

export const binanceProvider: PriceProvider = {
  key: 'binance',
  supportsSearch: false,

  async fetchBars(
    providerSymbol: string,
    interval: BarInterval,
    fromDate: string,
    toDate: string,
  ): Promise<NormalizedBars> {
    if (interval !== '1d') {
      throw new Error(`binance: intervalo no soportado ${interval}`);
    }

    const endMs = utcDateToMs(toDate) + DAY_MS - 1;
    const bars: Bar[] = [];
    const repairs: BarRepair[] = [];
    let cursorMs = utcDateToMs(fromDate);

    while (cursorMs <= endMs) {
      const url =
        `${BASE_URL}/api/v3/klines?symbol=${encodeURIComponent(providerSymbol)}` +
        `&interval=1d&startTime=${cursorMs}&endTime=${endMs}&limit=${MAX_LIMIT}`;

      const page = await fetchJson<Kline[]>(url, { limiter });
      if (page.length === 0) {
        break;
      }

      for (const kline of page) {
        const normalized = normalizeBar(
          {
            barDate: msToUtcDate(kline[0]),
            open: Number(kline[1]),
            high: Number(kline[2]),
            low: Number(kline[3]),
            close: Number(kline[4]),
            adjClose: Number(kline[4]),
            volume: Number(kline[5]),
          },
          providerSymbol,
        );
        bars.push(normalized.bar);
        repairs.push(...normalized.repairs);
      }

      const lastOpenTime = page[page.length - 1]?.[0];
      if (lastOpenTime === undefined) {
        break;
      }
      cursorMs = lastOpenTime + DAY_MS;

      if (page.length < MAX_LIMIT) {
        break;
      }
    }

    const today = msToUtcDate(Date.now());
    return { bars: bars.filter((bar) => bar.barDate < today), repairs };
  },

  async searchSymbols(): Promise<InstrumentHit[]> {
    return [];
  },
};
