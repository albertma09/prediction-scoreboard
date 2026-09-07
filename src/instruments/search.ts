import { query } from '../db/pool.js';
import { getProvider } from '../providers/registry.js';
import type { AssetClass } from '../config/index.js';
import { instrumentSeedSchema, upsertInstrument } from './catalog.js';

export interface SearchResult {
  id: number;
  symbol: string;
  name: string;
  assetClass: AssetClass;
  exchange: string | null;
  isTracked: boolean;
  scoredCount: number;
  score: number;
  origin: 'catalog' | 'provider';
}

interface SearchRow {
  id: number;
  symbol: string;
  name: string;
  asset_class: AssetClass;
  exchange: string | null;
  is_tracked: boolean;
  scored_count: string;
  score: number;
}

const MIN_SIMILARITY = 0.25;

export async function searchInstruments(
  rawQuery: string,
  limit = 12,
): Promise<SearchResult[]> {
  const needle = rawQuery.trim().toLowerCase();
  if (needle.length === 0) {
    return [];
  }

  const local = await searchCatalog(needle, limit);
  if (local.length > 0) {
    return local;
  }

  return searchViaProvider(needle, limit);
}

async function searchCatalog(needle: string, limit: number): Promise<SearchResult[]> {
  const rows = await query<SearchRow>(
    `with matched as (
       select i.id,
              max(
                greatest(
                  case when lower(i.symbol) = $1 then 1.0 else 0 end,
                  case when a.alias = $1 then 1.0 else 0 end,
                  case when lower(i.symbol) like $1 || '%' then 0.9 else 0 end,
                  case when a.alias like $1 || '%' then 0.85 else 0 end,
                  similarity(a.alias, $1),
                  similarity(lower(i.name), $1)
                )
              ) as score
       from instrument i
       left join instrument_alias a on a.instrument_id = i.id
       group by i.id
     )
     select i.id, i.symbol, i.name, i.asset_class, i.exchange, i.is_tracked,
            m.score,
            (select count(*) from prediction p
              join resolution r on r.prediction_id = p.id
              where p.instrument_id = i.id)::text as scored_count
     from matched m
     join instrument i on i.id = m.id
     where m.score >= $2
     order by m.score desc, i.is_tracked desc, i.symbol
     limit $3`,
    [needle, MIN_SIMILARITY, limit],
  );

  return rows.map((row) => ({
    id: row.id,
    symbol: row.symbol,
    name: row.name,
    assetClass: row.asset_class,
    exchange: row.exchange,
    isTracked: row.is_tracked,
    scoredCount: Number(row.scored_count),
    score: Number(row.score),
    origin: 'catalog' as const,
  }));
}

async function searchViaProvider(needle: string, limit: number): Promise<SearchResult[]> {
  const provider = getProvider('yahoo');
  if (!provider.supportsSearch) {
    return [];
  }

  const hits = await provider.searchSymbols(needle);
  const results: SearchResult[] = [];

  for (const hit of hits.slice(0, limit)) {
    if (hit.assetClass === 'fx') {
      continue;
    }

    const seed = instrumentSeedSchema.parse({
      symbol: hit.providerSymbol,
      name: hit.name,
      assetClass: hit.assetClass,
      provider: provider.key,
      providerSymbol: hit.providerSymbol,
      exchange: hit.exchange,
      currency: hit.currency,
      sessionTz: hit.assetClass === 'crypto' ? 'UTC' : 'America/New_York',
      tracked: false,
      aliases: [needle],
    });

    const id = await upsertInstrument(seed);

    results.push({
      id,
      symbol: seed.symbol,
      name: seed.name,
      assetClass: seed.assetClass,
      exchange: seed.exchange ?? null,
      isTracked: false,
      scoredCount: 0,
      score: 0,
      origin: 'provider',
    });
  }

  return results;
}
