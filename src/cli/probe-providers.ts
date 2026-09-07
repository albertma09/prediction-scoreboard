import { getProvider } from '../providers/registry.js';
import { todayUtc, yearsAgoUtc } from '../util/dates.js';

interface Probe {
  provider: string;
  providerSymbol: string;
  label: string;
}

const PROBES: Probe[] = [
  { provider: 'coinbase', providerSymbol: 'BTC-USD', label: 'BTC' },
  { provider: 'coinbase', providerSymbol: 'ETH-USD', label: 'ETH' },
  { provider: 'coinbase', providerSymbol: 'SOL-USD', label: 'SOL' },
  { provider: 'yahoo', providerSymbol: 'SPY', label: 'SPY' },
  { provider: 'yahoo', providerSymbol: 'QQQ', label: 'QQQ' },
  { provider: 'yahoo', providerSymbol: 'NVDA', label: 'NVDA' },
  { provider: 'yahoo', providerSymbol: 'AAPL', label: 'AAPL' },
  { provider: 'yahoo', providerSymbol: 'GLD', label: 'GLD' },
  { provider: 'yahoo', providerSymbol: 'EURUSD=X', label: 'EURUSD' },
];

async function probeBars(probe: Probe): Promise<void> {
  const provider = getProvider(probe.provider);
  const from = yearsAgoUtc(3);
  const to = todayUtc();

  const started = Date.now();
  try {
    const { bars, repairs } = await provider.fetchBars(probe.providerSymbol, '1d', from, to);
    const elapsed = Date.now() - started;
    const first = bars[0];
    const last = bars[bars.length - 1];

    if (!first || !last) {
      console.log(`FALLO ${probe.label.padEnd(7)} sin barras`);
      return;
    }

    const uniqueDates = new Set(bars.map((bar) => bar.barDate)).size;
    const duplicates = bars.length - uniqueDates;
    const adjusted = bars.filter((bar) => bar.adjClose !== bar.close).length;
    const flatBars = bars.filter((bar) => bar.open === bar.close).length;
    const flatPct = ((flatBars / bars.length) * 100).toFixed(1);

    console.log(
      `ok    ${probe.label.padEnd(7)} ${String(bars.length).padStart(5)} barras  ` +
        `${first.barDate} -> ${last.barDate}  cierre=${last.close}  ` +
        `dup=${duplicates}  ajust=${adjusted}  reparadas=${repairs.length}  ` +
        `open==close=${flatPct}%  ${elapsed}ms`,
    );
  } catch (error) {
    console.log(
      `FALLO ${probe.label.padEnd(7)} ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function probeSearch(query: string): Promise<void> {
  const provider = getProvider('yahoo');
  try {
    const hits = await provider.searchSymbols(query);
    const summary = hits
      .slice(0, 5)
      .map((hit) => `${hit.providerSymbol}[${hit.assetClass}]`)
      .join(' ');
    console.log(`ok    search "${query}" -> ${hits.length} resultados: ${summary}`);
  } catch (error) {
    console.log(
      `FALLO search "${query}" ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function main(): Promise<void> {
  console.log('=== barras diarias, 3 anios ===');
  for (const probe of PROBES) {
    await probeBars(probe);
  }

  console.log('');
  console.log('=== busqueda de simbolos ===');
  for (const query of ['bitcoin', 'nvidia', 'sp 500', 'inditex', 'oro']) {
    await probeSearch(query);
  }
}

void main();
