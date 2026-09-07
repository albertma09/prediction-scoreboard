import { providerFor } from '../config/index.js';
import type { AssetClass } from '../config/index.js';
import { binanceProvider } from './binance.js';
import { coinbaseProvider } from './coinbase.js';
import { yahooProvider } from './yahoo.js';
import type { PriceProvider } from './PriceProvider.js';

const providers = new Map<string, PriceProvider>([
  [binanceProvider.key, binanceProvider],
  [coinbaseProvider.key, coinbaseProvider],
  [yahooProvider.key, yahooProvider],
]);

export function getProvider(key: string): PriceProvider {
  const provider = providers.get(key);
  if (!provider) {
    throw new Error(
      `proveedor desconocido: ${key} (disponibles: ${[...providers.keys()].join(', ')})`,
    );
  }
  return provider;
}

export function getProviderForAssetClass(assetClass: AssetClass): PriceProvider {
  return getProvider(providerFor(assetClass));
}

export function searchCapableProviders(): PriceProvider[] {
  return [...providers.values()].filter((provider) => provider.supportsSearch);
}
