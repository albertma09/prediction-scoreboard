import { sha256 } from '../predictions/canonical.js';

export const GENESIS_HASH = '0'.repeat(64);

export interface ChainRow {
  id: number;
  payload_canonical: string;
  content_hash: string;
  prev_hash: string;
  chain_hash: string;
  instrument_symbol: string;
  model_key: string;
  model_version: string;
  event_type: string;
  event_key: string;
  horizon: string;
  t0_utc: string;
  window_end_utc: string;
  probability: string;
  features_hash: string;
  origin: string;
}

export type ChainBreakKind =
  | 'content_hash_mismatch'
  | 'prev_hash_mismatch'
  | 'chain_hash_mismatch'
  | 'column_mismatch'
  | 'payload_unreadable'
  | 'head_mismatch'
  | 'count_mismatch';

export interface ChainBreak {
  kind: ChainBreakKind;
  predictionId: number | null;
  field: string | null;
  expected: string;
  found: string;
  detail: string;
}

export interface ChainReport {
  ok: boolean;
  checked: number;
  headHash: string;
  breaks: ChainBreak[];
}

export function computeChainHash(prevHash: string, contentHash: string): string {
  return sha256(`${prevHash}${contentHash}`);
}

const COLUMN_TO_PAYLOAD: Array<[keyof ChainRow, string]> = [
  ['instrument_symbol', 'instrumentSymbol'],
  ['model_key', 'modelKey'],
  ['model_version', 'modelVersion'],
  ['event_type', 'eventType'],
  ['event_key', 'eventKey'],
  ['horizon', 'horizon'],
  ['probability', 'probability'],
  ['features_hash', 'featuresHash'],
  ['origin', 'origin'],
];

const TIMESTAMP_COLUMNS: Array<[keyof ChainRow, string]> = [
  ['t0_utc', 't0Utc'],
  ['window_end_utc', 'windowEndUtc'],
];

export function verifyChain(
  rows: ChainRow[],
  declaredHead?: { headHash: string; predictionCount: number },
): ChainReport {
  const breaks: ChainBreak[] = [];
  let previousChainHash = GENESIS_HASH;

  for (const row of rows) {
    const recomputedContent = sha256(row.payload_canonical);
    if (recomputedContent !== row.content_hash) {
      breaks.push({
        kind: 'content_hash_mismatch',
        predictionId: row.id,
        field: 'payload_canonical',
        expected: row.content_hash,
        found: recomputedContent,
        detail: 'el payload almacenado no produce el content_hash registrado',
      });
    }

    if (row.prev_hash !== previousChainHash) {
      breaks.push({
        kind: 'prev_hash_mismatch',
        predictionId: row.id,
        field: 'prev_hash',
        expected: previousChainHash,
        found: row.prev_hash,
        detail: 'el eslabon no apunta al chain_hash de la prediccion anterior',
      });
    }

    const recomputedChain = computeChainHash(row.prev_hash, row.content_hash);
    if (recomputedChain !== row.chain_hash) {
      breaks.push({
        kind: 'chain_hash_mismatch',
        predictionId: row.id,
        field: 'chain_hash',
        expected: row.chain_hash,
        found: recomputedChain,
        detail: 'el chain_hash no se deriva de prev_hash + content_hash',
      });
    }

    breaks.push(...crossCheckColumns(row));

    previousChainHash = row.chain_hash;
  }

  if (declaredHead) {
    if (declaredHead.headHash !== previousChainHash) {
      breaks.push({
        kind: 'head_mismatch',
        predictionId: null,
        field: null,
        expected: previousChainHash,
        found: declaredHead.headHash,
        detail: 'la cabecera declarada no coincide con el final de la cadena',
      });
    }
    if (declaredHead.predictionCount !== rows.length) {
      breaks.push({
        kind: 'count_mismatch',
        predictionId: null,
        field: null,
        expected: String(rows.length),
        found: String(declaredHead.predictionCount),
        detail: 'el contador de la cabecera no coincide con las filas presentes',
      });
    }
  }

  return {
    ok: breaks.length === 0,
    checked: rows.length,
    headHash: previousChainHash,
    breaks,
  };
}

function crossCheckColumns(row: ChainRow): ChainBreak[] {
  let payload: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(row.payload_canonical);
    if (parsed === null || typeof parsed !== 'object') {
      throw new Error('el payload no es un objeto');
    }
    payload = parsed as Record<string, unknown>;
  } catch (error) {
    return [
      {
        kind: 'payload_unreadable',
        predictionId: row.id,
        field: 'payload_canonical',
        expected: 'json valido',
        found: error instanceof Error ? error.message : 'error de parseo',
        detail: 'el payload canonico no se puede leer',
      },
    ];
  }

  const breaks: ChainBreak[] = [];

  for (const [column, payloadKey] of COLUMN_TO_PAYLOAD) {
    const columnValue = String(row[column]);
    const payloadValue = payload[payloadKey];
    if (typeof payloadValue !== 'string' || payloadValue !== columnValue) {
      breaks.push({
        kind: 'column_mismatch',
        predictionId: row.id,
        field: String(column),
        expected: typeof payloadValue === 'string' ? payloadValue : 'ausente',
        found: columnValue,
        detail: `la columna ${String(column)} no coincide con el payload firmado`,
      });
    }
  }

  for (const [column, payloadKey] of TIMESTAMP_COLUMNS) {
    const columnValue = normalizeTimestamp(String(row[column]));
    const payloadValue = payload[payloadKey];
    const normalizedPayload =
      typeof payloadValue === 'string' ? normalizeTimestamp(payloadValue) : null;

    if (normalizedPayload === null || normalizedPayload !== columnValue) {
      breaks.push({
        kind: 'column_mismatch',
        predictionId: row.id,
        field: String(column),
        expected: normalizedPayload ?? 'ausente',
        found: columnValue,
        detail: `la columna ${String(column)} no coincide con el payload firmado`,
      });
    }
  }

  return breaks;
}

function normalizeTimestamp(value: string): string {
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? `invalido:${value}` : new Date(ms).toISOString();
}
