import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from '../config/index.js';
import { query, withTransaction } from '../db/pool.js';
import { buildCanonicalPrediction } from '../predictions/canonical.js';
import type { PredictionDraft } from '../predictions/canonical.js';
import { computeChainHash, GENESIS_HASH, verifyChain } from './chain.js';
import type { ChainReport, ChainRow } from './chain.js';

export interface AppendInput {
  instrumentId: number;
  modelVersionId: number;
  draft: PredictionDraft;
  allowLateEmissionMs?: number;
  allowClosedWindow?: boolean;
}

export interface AppendResult {
  id: number;
  uuid: string;
  eventKey: string;
  contentHash: string;
  prevHash: string;
  chainHash: string;
  probabilityText: string;
}

export class LedgerRejection extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LedgerRejection';
  }
}

export const EMISSION_TOLERANCE_MS = 30 * 60_000;

export async function append(input: AppendInput): Promise<AppendResult> {
  const { draft } = input;
  const now = Date.now();
  const t0 = draft.t0Utc.getTime();

  if (draft.windowEndUtc.getTime() <= t0) {
    throw new LedgerRejection('la ventana termina antes o al mismo tiempo que t0');
  }

  if (draft.windowEndUtc.getTime() <= now && input.allowClosedWindow !== true) {
    throw new LedgerRejection(
      `la ventana ya esta cerrada (${draft.windowEndUtc.toISOString()}); ` +
        'no se registra ninguna prediccion sobre un periodo pasado',
    );
  }

  if (t0 % 86_400_000 !== 0) {
    throw new LedgerRejection(
      `t0 no es un slot canonico de medianoche UTC: ${draft.t0Utc.toISOString()}`,
    );
  }

  if (t0 > now + 60_000) {
    throw new LedgerRejection('t0 esta en el futuro; la emision debe registrarse en el momento');
  }

  const tolerance = input.allowLateEmissionMs ?? EMISSION_TOLERANCE_MS;
  if (now - t0 > tolerance) {
    throw new LedgerRejection(
      `el slot t0 ${draft.t0Utc.toISOString()} se abrio hace ` +
        `${Math.round((now - t0) / 60_000)} minutos (tolerancia ${Math.round(tolerance / 60_000)}); ` +
        'emitir con retraso permitiria ver parte del movimiento a predecir',
    );
  }

  const canonical = buildCanonicalPrediction(draft);

  return withTransaction(async (client) => {
    const head = await client.query<{ head_hash: string; prediction_count: string }>(
      'select head_hash, prediction_count::text from ledger_head where id = 1 for update',
    );

    const previous = head.rows[0];
    if (!previous) {
      throw new Error('ledger_head sin inicializar; ejecuta las migraciones');
    }

    const prevHash = previous.head_hash;
    const chainHash = computeChainHash(prevHash, canonical.contentHash);

    const inserted = await client.query<{ id: number; uuid: string }>(
      `insert into prediction
         (instrument_id, model_version_id, event_type, event_key, event_params, horizon,
          t0_utc, window_end_utc, probability, features_hash, origin,
          payload_canonical, content_hash, prev_hash, chain_hash)
       values ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       returning id, uuid::text as uuid`,
      [
        input.instrumentId,
        input.modelVersionId,
        draft.spec.type,
        canonical.eventKey,
        JSON.stringify(draft.spec.params),
        draft.horizon,
        draft.t0Utc.toISOString(),
        draft.windowEndUtc.toISOString(),
        canonical.probabilityText,
        draft.featuresHash,
        draft.origin,
        canonical.payload,
        canonical.contentHash,
        prevHash,
        chainHash,
      ],
    );

    const row = inserted.rows[0];
    if (!row) {
      throw new Error('la insercion de la prediccion no devolvio fila');
    }

    await client.query(
      `update ledger_head
       set head_hash = $1, prediction_count = prediction_count + 1, updated_at = now()
       where id = 1`,
      [chainHash],
    );

    return {
      id: row.id,
      uuid: row.uuid,
      eventKey: canonical.eventKey,
      contentHash: canonical.contentHash,
      prevHash,
      chainHash,
      probabilityText: canonical.probabilityText,
    };
  });
}

export async function loadChain(): Promise<ChainRow[]> {
  return query<ChainRow>(
    `select p.id, p.payload_canonical, p.content_hash, p.prev_hash, p.chain_hash,
            i.symbol as instrument_symbol,
            m.model_key, m.version as model_version,
            p.event_type, p.event_key, p.horizon,
            to_char(p.t0_utc at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as t0_utc,
            to_char(p.window_end_utc at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as window_end_utc,
            to_char(p.probability, 'FM0.00000') as probability,
            p.features_hash, p.origin
     from prediction p
     join instrument i on i.id = p.instrument_id
     join model_version m on m.id = p.model_version_id
     order by p.id asc`,
  );
}

export async function readHead(): Promise<{ headHash: string; predictionCount: number }> {
  const rows = await query<{ head_hash: string; prediction_count: string }>(
    'select head_hash, prediction_count::text from ledger_head where id = 1',
  );
  const row = rows[0];
  if (!row) {
    throw new Error('ledger_head sin inicializar; ejecuta las migraciones');
  }
  return { headHash: row.head_hash, predictionCount: Number(row.prediction_count) };
}

export async function verify(): Promise<ChainReport> {
  const [rows, head] = await Promise.all([loadChain(), readHead()]);
  return verifyChain(rows, head);
}

export async function anchor(): Promise<{ path: string; headHash: string; count: number }> {
  const report = await verify();
  if (!report.ok) {
    throw new Error(
      `la cadena esta rota: ${report.breaks.length} incidencias; no se ancla una cadena invalida`,
    );
  }

  const head = await readHead();
  const anchoredAt = new Date().toISOString();
  const body = {
    chainHeadHash: head.headHash,
    predictionCount: head.predictionCount,
    anchoredAt,
    genesisHash: GENESIS_HASH,
  };

  await mkdir(config.LEDGER_ANCHOR_DIR, { recursive: true });
  const path = join(config.LEDGER_ANCHOR_DIR, `${anchoredAt.slice(0, 10)}.json`);
  await writeFile(path, `${JSON.stringify(body, null, 2)}\n`, 'utf8');

  await query(
    'insert into ledger_anchor (chain_head_hash, prediction_count) values ($1, $2)',
    [head.headHash, head.predictionCount],
  );

  return { path, headHash: head.headHash, count: head.predictionCount };
}
