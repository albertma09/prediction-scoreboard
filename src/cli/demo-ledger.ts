import { closePool, query } from '../db/pool.js';
import { runMigrations } from '../db/migrate.js';
import { hashFeatures } from '../predictions/canonical.js';
import type { PredictionDraft } from '../predictions/canonical.js';
import { append, LedgerRejection, verify } from '../ledger/ledger.js';

import type { EventSpec } from '../predictions/events.js';

const DAY_MS = 86_400_000;
const RELAXED = 400 * DAY_MS;

async function setup(): Promise<{ instrumentId: number; modelVersionId: number }> {
  await runMigrations();

  const instrument = await query<{ id: number }>(
    `insert into instrument
       (symbol, name, asset_class, provider, provider_symbol, currency, session_tz, is_tracked, tracked_since)
     values ('BTCUSD', 'Bitcoin', 'crypto', 'binance', 'BTCUSDT', 'USD', 'UTC', true, now())
     on conflict (symbol) do update set name = excluded.name
     returning id`,
  );

  const model = await query<{ id: number }>(
    `insert into model_version (model_key, version, params, code_hash, is_baseline)
     values ('demo', '1.0.0', '{}'::jsonb, $1, true)
     on conflict (model_key, version) do update set code_hash = excluded.code_hash
     returning id`,
    ['d'.repeat(64)],
  );

  const instrumentId = instrument[0]?.id;
  const modelVersionId = model[0]?.id;
  if (instrumentId === undefined || modelVersionId === undefined) {
    throw new Error('no se pudo preparar el escenario');
  }
  return { instrumentId, modelVersionId };
}

function draftFor(probability: number, kSigma: number, offsetDays: number): PredictionDraft {
  const t0 = new Date(Math.floor(Date.now() / DAY_MS) * DAY_MS);
  const spec: EventSpec = {
    type: 'MAG',
    params: { kSigma, sigmaWindow: 30, thresholdAbs: 0.05 + kSigma / 1000 },
  };

  return {
    instrumentSymbol: 'BTCUSD',
    modelKey: 'demo',
    modelVersion: '1.0.0',
    spec,
    horizon: '7d',
    t0Utc: t0,
    windowEndUtc: new Date(t0.getTime() + offsetDays * DAY_MS),
    probability,
    origin: 'scheduled',
    featuresHash: hashFeatures([
      { barDate: '2026-09-05', adjClose: 80000 + kSigma },
      { barDate: '2026-09-06', adjClose: 80341.83 },
    ]),
  };
}

async function main(): Promise<void> {
  const { instrumentId, modelVersionId } = await setup();

  console.log('=== 1. append de tres predicciones (tolerancia de emision relajada) ===');
  const appended = [];
  for (const [index, probability] of [0.35, 0.62, 0.5].entries()) {
    const result = await append({
      instrumentId,
      modelVersionId,
      draft: draftFor(probability, 1 + index * 0.5, 7 + index),
      allowLateEmissionMs: RELAXED,
    });
    appended.push(result);
    console.log(
      `  id=${result.id} ${result.eventKey.padEnd(16)} p=${result.probabilityText} ` +
        `chain=${result.chainHash.slice(0, 16)}...`,
    );
  }

  console.log('');
  console.log('=== 2. guardas de emision ===');
  try {
    const late = draftFor(0.5, 9, 7);
    await append({ instrumentId, modelVersionId, draft: late });
    console.log('  TEST FALLIDO: acepto una emision tardia con la tolerancia real');
  } catch (error) {
    const kind = error instanceof LedgerRejection ? 'rechazado ok' : 'error inesperado';
    console.log(`  ${kind}: emision tardia con tolerancia de 30 min`);
  }

  try {
    const past = draftFor(0.5, 9, -1);
    await append({ instrumentId, modelVersionId, draft: past, allowLateEmissionMs: RELAXED });
    console.log('  TEST FALLIDO: acepto una ventana ya cerrada');
  } catch (error) {
    const kind = error instanceof LedgerRejection ? 'rechazado ok' : 'error inesperado';
    console.log(`  ${kind}: ${error instanceof Error ? error.message.slice(0, 70) : error}`);
  }

  try {
    await append({
      instrumentId,
      modelVersionId,
      draft: draftFor(0.35, 1, 7),
      allowLateEmissionMs: RELAXED,
    });
    console.log('  TEST FALLIDO: acepto una emision duplicada');
  } catch (error) {
    const constraint =
      error !== null && typeof error === 'object' && 'constraint' in error
        ? String((error as { constraint?: unknown }).constraint)
        : 'desconocida';
    console.log(`  rechazado ok: duplicado de la misma ventana (${constraint})`);
  }

  try {
    const other = draftFor(0.71, 1, 7);
    await append({ instrumentId, modelVersionId, draft: other, allowLateEmissionMs: RELAXED });
    console.log('  TEST FALLIDO: acepto otra probabilidad para la misma ventana');
  } catch (error) {
    const constraint =
      error !== null && typeof error === 'object' && 'constraint' in error
        ? String((error as { constraint?: unknown }).constraint)
        : 'desconocida';
    console.log(`  rechazado ok: reemision de la misma ventana con otra p (${constraint})`);
  }

  console.log('');
  console.log('=== 3. verificacion de la cadena ===');
  const clean = await verify();
  console.log(`  filas=${clean.checked} estado=${clean.ok ? 'INTACTA' : 'ROTA'}`);

  console.log('');
  console.log('=== 4. ataque: superusuario desactiva el trigger y manipula ===');
  await query('alter table prediction disable trigger prediction_append_only');
  await query('update prediction set probability = 0.999 where id = $1', [appended[0]?.id]);
  await query('alter table prediction enable trigger prediction_append_only');
  console.log('  probabilidad de la prediccion 1 reescrita de 0.35000 a 0.999');

  const tampered = await verify();
  console.log(`  estado=${tampered.ok ? 'INTACTA (FALLO DEL TEST)' : 'ROTA'}`);
  for (const issue of tampered.breaks) {
    console.log(`  detectado [${issue.kind}] en prediccion ${issue.predictionId}`);
  }

  console.log('');
  console.log('=== 5. ataque mas fino: reescribir tambien el payload ===');
  await query('alter table prediction disable trigger prediction_append_only');
  await query(
    `update prediction
     set payload_canonical = replace(payload_canonical, '"0.35000"', '"0.99900"')
     where id = $1`,
    [appended[0]?.id],
  );
  await query('alter table prediction enable trigger prediction_append_only');
  console.log('  payload reescrito para que cuadre con la probabilidad manipulada');

  const deeper = await verify();
  console.log(`  estado=${deeper.ok ? 'INTACTA (FALLO DEL TEST)' : 'ROTA'}`);
  for (const issue of deeper.breaks) {
    console.log(`  detectado [${issue.kind}] en prediccion ${issue.predictionId}`);
  }
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => {
    void closePool();
  });
