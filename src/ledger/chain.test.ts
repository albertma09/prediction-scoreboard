import { describe, expect, it } from 'vitest';
import { canonicalJson, sha256 } from '../predictions/canonical.js';
import type { CanonicalObject } from '../predictions/canonical.js';
import { computeChainHash, GENESIS_HASH, verifyChain } from './chain.js';
import type { ChainRow } from './chain.js';

interface Spec {
  probability: string;
  eventKey: string;
  windowEndUtc: string;
}

const SPECS: Spec[] = [
  { probability: '0.35000', eventKey: 'MAG:k=1.0,w=30', windowEndUtc: '2026-09-14T00:00:00.000Z' },
  { probability: '0.62000', eventKey: 'MAG:k=1.5,w=30', windowEndUtc: '2026-09-15T00:00:00.000Z' },
  { probability: '0.50000', eventKey: 'DIR:', windowEndUtc: '2026-09-16T00:00:00.000Z' },
  { probability: '0.41000', eventKey: 'VOL:b=7', windowEndUtc: '2026-09-17T00:00:00.000Z' },
];

function rowFor(id: number, spec: Spec, prevHash: string): ChainRow {
  const payloadObject: CanonicalObject = {
    schemaVersion: '1',
    instrumentSymbol: 'BTCUSD',
    modelKey: 'ewmaVol',
    modelVersion: '1.0.0',
    eventType: spec.eventKey.slice(0, 3),
    eventKey: spec.eventKey,
    eventParams: {},
    horizon: '7d',
    t0Utc: '2026-09-07T00:00:00.000Z',
    windowEndUtc: spec.windowEndUtc,
    probability: spec.probability,
    origin: 'scheduled',
    featuresHash: 'a'.repeat(64),
  };

  const payload = canonicalJson(payloadObject);
  const contentHash = sha256(payload);

  return {
    id,
    payload_canonical: payload,
    content_hash: contentHash,
    prev_hash: prevHash,
    chain_hash: computeChainHash(prevHash, contentHash),
    instrument_symbol: 'BTCUSD',
    model_key: 'ewmaVol',
    model_version: '1.0.0',
    event_type: spec.eventKey.slice(0, 3),
    event_key: spec.eventKey,
    horizon: '7d',
    t0_utc: '2026-09-07T00:00:00.000Z',
    window_end_utc: spec.windowEndUtc,
    probability: spec.probability,
    features_hash: 'a'.repeat(64),
    origin: 'scheduled',
  };
}

function buildChain(): ChainRow[] {
  const rows: ChainRow[] = [];
  let prevHash = GENESIS_HASH;
  SPECS.forEach((spec, index) => {
    const row = rowFor(index + 1, spec, prevHash);
    rows.push(row);
    prevHash = row.chain_hash;
  });
  return rows;
}

describe('verifyChain: cadena intacta', () => {
  it('acepta una cadena bien formada', () => {
    const rows = buildChain();
    const report = verifyChain(rows);
    expect(report.breaks).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.checked).toBe(4);
    expect(report.headHash).toBe(rows[3]?.chain_hash);
  });

  it('acepta una cadena vacia con la cabecera en genesis', () => {
    const report = verifyChain([], { headHash: GENESIS_HASH, predictionCount: 0 });
    expect(report.ok).toBe(true);
    expect(report.headHash).toBe(GENESIS_HASH);
  });

  it('tolera formatos de fecha equivalentes entre columna y payload', () => {
    const rows = buildChain();
    rows[0] = { ...rows[0]!, window_end_utc: '2026-09-14 00:00:00+00' };
    expect(verifyChain(rows).ok).toBe(true);
  });
});

describe('verifyChain: manipulacion del payload', () => {
  it('detecta un payload alterado', () => {
    const rows = buildChain();
    rows[1] = { ...rows[1]!, payload_canonical: '{"a":"99"}' };
    const report = verifyChain(rows);
    expect(report.ok).toBe(false);
    expect(report.breaks.find((b) => b.kind === 'content_hash_mismatch')?.predictionId).toBe(2);
  });

  it('detecta un content_hash recalculado sobre el payload alterado', () => {
    const rows = buildChain();
    const tampered = '{"a":"99"}';
    rows[1] = { ...rows[1]!, payload_canonical: tampered, content_hash: sha256(tampered) };
    const report = verifyChain(rows);
    expect(report.ok).toBe(false);
    expect(report.breaks.some((b) => b.kind === 'chain_hash_mismatch')).toBe(true);
  });

  it('detecta una fila entera recalculada por el eslabon siguiente', () => {
    const rows = buildChain();
    const tampered = '{"a":"99"}';
    const contentHash = sha256(tampered);
    rows[1] = {
      ...rows[1]!,
      payload_canonical: tampered,
      content_hash: contentHash,
      chain_hash: computeChainHash(rows[1]!.prev_hash, contentHash),
    };
    const report = verifyChain(rows);
    expect(report.ok).toBe(false);
    expect(report.breaks.find((b) => b.kind === 'prev_hash_mismatch')?.predictionId).toBe(3);
  });

  it('detecta un payload ilegible', () => {
    const rows = buildChain();
    const broken = 'no soy json';
    rows[0] = { ...rows[0]!, payload_canonical: broken, content_hash: sha256(broken) };
    const report = verifyChain(rows);
    expect(report.breaks.some((b) => b.kind === 'payload_unreadable')).toBe(true);
  });
});

describe('verifyChain: manipulacion de columnas', () => {
  it('detecta una probabilidad reescrita solo en la columna', () => {
    const rows = buildChain();
    rows[0] = { ...rows[0]!, probability: '0.99900' };
    const report = verifyChain(rows);
    expect(report.ok).toBe(false);
    const issue = report.breaks.find((b) => b.kind === 'column_mismatch');
    expect(issue?.field).toBe('probability');
    expect(issue?.expected).toBe('0.35000');
    expect(issue?.found).toBe('0.99900');
  });

  it('detecta un instrumento reasignado', () => {
    const rows = buildChain();
    rows[2] = { ...rows[2]!, instrument_symbol: 'ETHUSD' };
    const report = verifyChain(rows);
    expect(report.breaks.some((b) => b.field === 'instrument_symbol')).toBe(true);
  });

  it('detecta una ventana movida en el tiempo', () => {
    const rows = buildChain();
    rows[1] = { ...rows[1]!, window_end_utc: '2026-10-01T00:00:00.000Z' };
    const report = verifyChain(rows);
    expect(report.breaks.some((b) => b.field === 'window_end_utc')).toBe(true);
  });

  it('detecta un modelo reatribuido', () => {
    const rows = buildChain();
    rows[0] = { ...rows[0]!, model_version: '2.0.0' };
    const report = verifyChain(rows);
    expect(report.breaks.some((b) => b.field === 'model_version')).toBe(true);
  });

  it('detecta un evento cambiado', () => {
    const rows = buildChain();
    rows[3] = { ...rows[3]!, event_key: 'VOL:b=5' };
    const report = verifyChain(rows);
    expect(report.breaks.some((b) => b.field === 'event_key')).toBe(true);
  });
});

describe('verifyChain: filas ausentes o reordenadas', () => {
  it('detecta una fila eliminada del medio', () => {
    const rows = buildChain();
    const report = verifyChain([rows[0]!, rows[2]!, rows[3]!]);
    expect(report.breaks.some((b) => b.kind === 'prev_hash_mismatch')).toBe(true);
  });

  it('detecta filas reordenadas', () => {
    const rows = buildChain();
    expect(verifyChain([rows[0]!, rows[2]!, rows[1]!, rows[3]!]).ok).toBe(false);
  });

  it('el primer eslabon debe apuntar a genesis', () => {
    const rows = buildChain();
    rows[0] = { ...rows[0]!, prev_hash: 'a'.repeat(64) };
    const report = verifyChain(rows);
    const issue = report.breaks.find((b) => b.kind === 'prev_hash_mismatch');
    expect(issue?.predictionId).toBe(1);
    expect(issue?.expected).toBe(GENESIS_HASH);
  });
});

describe('verifyChain: cabecera', () => {
  it('detecta una cabecera que no coincide', () => {
    const rows = buildChain();
    const report = verifyChain(rows, { headHash: 'f'.repeat(64), predictionCount: 4 });
    expect(report.breaks.find((b) => b.kind === 'head_mismatch')?.expected).toBe(
      rows[3]?.chain_hash,
    );
  });

  it('detecta un contador que no cuadra', () => {
    const rows = buildChain();
    const report = verifyChain(rows, { headHash: rows[3]!.chain_hash, predictionCount: 7 });
    expect(report.breaks.some((b) => b.kind === 'count_mismatch')).toBe(true);
  });

  it('un truncado del final solo se detecta con la cabecera', () => {
    const rows = buildChain();
    const truncated = rows.slice(0, 3);
    expect(verifyChain(truncated).ok).toBe(true);
    expect(
      verifyChain(truncated, { headHash: rows[3]!.chain_hash, predictionCount: 4 }).ok,
    ).toBe(false);
  });
});
