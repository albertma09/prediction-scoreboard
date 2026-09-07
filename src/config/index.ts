import { config as loadEnv } from 'dotenv';
import { z } from 'zod';

loadEnv(process.env.ENV_FILE === undefined ? {} : { path: process.env.ENV_FILE });

process.env.TZ = 'UTC';

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  API_PORT: z.coerce.number().int().positive().default(3311),
  API_HOST: z.string().default('127.0.0.1'),
  PROVIDER_CRYPTO: z.string().default('coinbase'),
  PROVIDER_EQUITY: z.string().default('yahoo'),
  PROVIDER_ETF: z.string().default('yahoo'),
  PROVIDER_INDEX: z.string().default('yahoo'),
  PROVIDER_FX: z.string().default('yahoo'),
  BACKFILL_YEARS: z.coerce.number().int().positive().max(20).default(3),
  LEDGER_ANCHOR_DIR: z.string().default('./ledger-anchors'),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');
  throw new Error(`configuracion invalida en .env\n${issues}`);
}

export const config = parsed.data;

export type AssetClass = 'crypto' | 'equity' | 'etf' | 'index' | 'fx';

export function providerFor(assetClass: AssetClass): string {
  switch (assetClass) {
    case 'crypto':
      return config.PROVIDER_CRYPTO;
    case 'equity':
      return config.PROVIDER_EQUITY;
    case 'etf':
      return config.PROVIDER_ETF;
    case 'index':
      return config.PROVIDER_INDEX;
    case 'fx':
      return config.PROVIDER_FX;
  }
}
