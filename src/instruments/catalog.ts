import { z } from 'zod';
import { query, queryOne, withTransaction } from '../db/pool.js';
import type { AssetClass } from '../config/index.js';

export const assetClassSchema = z.enum(['crypto', 'equity', 'etf', 'index', 'fx']);

export const instrumentSeedSchema = z.object({
  symbol: z.string().min(1).max(32),
  name: z.string().min(1),
  assetClass: assetClassSchema,
  provider: z.string().min(1),
  providerSymbol: z.string().min(1),
  exchange: z.string().nullable().optional(),
  currency: z.string().length(3).default('USD'),
  sessionTz: z.string().min(1).default('UTC'),
  tracked: z.boolean().default(false),
  aliases: z.array(z.string().min(1)).default([]),
});

export type InstrumentSeed = z.infer<typeof instrumentSeedSchema>;

export interface InstrumentRow {
  id: number;
  symbol: string;
  name: string;
  asset_class: AssetClass;
  provider: string;
  provider_symbol: string;
  exchange: string | null;
  currency: string;
  session_tz: string;
  is_tracked: boolean;
  tracked_since: Date | null;
}

export async function upsertInstrument(seed: InstrumentSeed): Promise<number> {
  return withTransaction(async (client) => {
    const inserted = await client.query<{ id: number }>(
      `insert into instrument
         (symbol, name, asset_class, provider, provider_symbol, exchange, currency, session_tz, is_tracked, tracked_since)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, case when $9 then now() else null end)
       on conflict (symbol) do update set
         name = excluded.name,
         provider = excluded.provider,
         provider_symbol = excluded.provider_symbol,
         exchange = excluded.exchange,
         currency = excluded.currency,
         session_tz = excluded.session_tz
       returning id`,
      [
        seed.symbol,
        seed.name,
        seed.assetClass,
        seed.provider,
        seed.providerSymbol,
        seed.exchange ?? null,
        seed.currency,
        seed.sessionTz,
        seed.tracked,
      ],
    );

    const id = inserted.rows[0]?.id;
    if (id === undefined) {
      throw new Error(`no se pudo insertar el instrumento ${seed.symbol}`);
    }

    const aliases = new Set([
      seed.symbol.toLowerCase(),
      seed.name.toLowerCase(),
      ...seed.aliases.map((alias) => alias.toLowerCase()),
    ]);

    for (const alias of aliases) {
      await client.query(
        `insert into instrument_alias (instrument_id, alias)
         values ($1, $2)
         on conflict do nothing`,
        [id, alias],
      );
    }

    return id;
  });
}

export async function getInstrumentBySymbol(symbol: string): Promise<InstrumentRow | null> {
  return queryOne<InstrumentRow>(
    `select id, symbol, name, asset_class, provider, provider_symbol,
            exchange, currency, session_tz, is_tracked, tracked_since
     from instrument
     where upper(symbol) = upper($1)`,
    [symbol],
  );
}

export async function listTrackedInstruments(): Promise<InstrumentRow[]> {
  return query<InstrumentRow>(
    `select id, symbol, name, asset_class, provider, provider_symbol,
            exchange, currency, session_tz, is_tracked, tracked_since
     from instrument
     where is_tracked = true
     order by asset_class, symbol`,
  );
}

export async function listAllInstruments(): Promise<InstrumentRow[]> {
  return query<InstrumentRow>(
    `select id, symbol, name, asset_class, provider, provider_symbol,
            exchange, currency, session_tz, is_tracked, tracked_since
     from instrument
     order by is_tracked desc, asset_class, symbol`,
  );
}

export async function setTracked(symbol: string, tracked: boolean): Promise<InstrumentRow> {
  const updated = await queryOne<InstrumentRow>(
    `update instrument
     set is_tracked = $2,
         tracked_since = case when $2 then coalesce(tracked_since, now()) else null end
     where upper(symbol) = upper($1)
     returning id, symbol, name, asset_class, provider, provider_symbol,
               exchange, currency, session_tz, is_tracked, tracked_since`,
    [symbol, tracked],
  );

  if (!updated) {
    throw new Error(`instrumento no encontrado en el catalogo: ${symbol}`);
  }

  return updated;
}

export async function countScoredPredictions(instrumentId: number): Promise<number> {
  const row = await queryOne<{ total: string }>(
    `select count(*)::text as total
     from prediction p
     join resolution r on r.prediction_id = p.id
     where p.instrument_id = $1`,
    [instrumentId],
  );
  return Number(row?.total ?? 0);
}
