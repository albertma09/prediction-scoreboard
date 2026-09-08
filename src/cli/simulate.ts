import { closePool, query } from '../db/pool.js';
import { config } from '../config/index.js';
import { emitForSlot } from '../schedule/emit.js';
import { resolvePending } from '../resolve/resolver.js';
import { verify } from '../ledger/ledger.js';
import { pooledSkillScore } from '../eval/brier.js';
import type { PairedScore } from '../eval/brier.js';

const DAY_MS = 86_400_000;
const RELAXED_TOLERANCE = 400 * DAY_MS;

async function guardThrowawayDatabase(): Promise<void> {
  if (!process.argv.includes('--yes-throwaway-db')) {
    throw new Error(
      'este comando escribe en el ledger append-only.\n' +
        'solo debe usarse contra una base de datos desechable.\n' +
        'si es el caso, repite el comando con --yes-throwaway-db',
    );
  }

  const rows = await query<{ n: string }>('select count(*)::text as n from prediction');
  const existing = Number(rows[0]?.n ?? 0);

  if (existing > 0) {
    throw new Error(
      `el ledger ya contiene ${existing} predicciones.\n` +
        'el simulacro se niega a escribir sobre un registro con datos: ' +
        'lo que se escribe en el ledger no se puede borrar.',
    );
  }

  const url = new URL(config.DATABASE_URL);
  console.log(`base de datos objetivo: ${url.hostname}${url.pathname}`);
  console.log('ledger vacio, se puede simular');
  console.log('');
}

async function main(): Promise<void> {
  await guardThrowawayDatabase();

  const daysArg = process.argv.find((arg) => arg.startsWith('--days='));
  const days = daysArg === undefined ? 45 : Number(daysArg.split('=')[1]);

  console.log(`=== simulando ${days} dias consecutivos de emision ===`);

  const today = Math.floor(Date.now() / DAY_MS) * DAY_MS;
  let totalEmitted = 0;
  let totalSkippedSession = 0;

  for (let offset = days; offset >= 1; offset -= 1) {
    const slotMs = today - offset * DAY_MS;
    const report = await emitForSlot(slotMs, {
      allowPastSlotMs: RELAXED_TOLERANCE,
      allowClosedWindow: true,
    });
    totalEmitted += report.emitted;
    totalSkippedSession += report.skippedNoSession;

    if (offset % 15 === 0 || offset === 1) {
      console.log(
        `  ${report.slotDate}: ${report.status} · emitidas=${report.emitted} ` +
          `· sin sesion=${report.skippedNoSession}`,
      );
    }
  }

  console.log('');
  console.log(`total emitidas          : ${totalEmitted}`);
  console.log(`total saltadas sin sesion: ${totalSkippedSession}`);

  console.log('');
  console.log('=== resolviendo lo que ha vencido ===');
  const resolution = await resolvePending();
  console.log(`  resueltas : ${resolution.resolved}`);
  console.log(`  nulas     : ${resolution.voided}`);
  console.log(`  aplazadas : ${resolution.deferred}`);

  const voidReasons = await query<{ void_reason: string; n: string }>(
    `select void_reason, count(*)::text as n
     from resolution where void_reason is not null
     group by void_reason order by count(*) desc`,
  );
  for (const row of voidReasons) {
    console.log(`    ${row.void_reason}: ${row.n}`);
  }

  console.log('');
  console.log('=== verificacion de la cadena ===');
  const chain = await verify();
  console.log(`  filas=${chain.checked} estado=${chain.ok ? 'INTACTA' : 'ROTA'}`);
  for (const issue of chain.breaks.slice(0, 5)) {
    console.log(`    [${issue.kind}] prediccion ${issue.predictionId}: ${issue.detail}`);
  }

  console.log('');
  console.log('=== track record REAL del ledger ===');
  const scored = await query<{
    horizon: string;
    event_key: string;
    model_key: string;
    n: string;
    probability: string;
    outcome: number;
  }>(
    `select p.horizon, p.event_key, m.model_key, '1' as n,
            p.probability::text, r.outcome
     from prediction p
     join model_version m on m.id = p.model_version_id
     join resolution r on r.prediction_id = p.id
     where r.outcome is not null
     order by p.horizon, p.event_key, m.model_key`,
  );

  const buckets = new Map<string, Map<string, Array<{ p: number; o: 0 | 1 }>>>();
  for (const row of scored) {
    const key = `${row.horizon}|${row.event_key}`;
    const byModel = buckets.get(key) ?? new Map();
    const list = byModel.get(row.model_key) ?? [];
    list.push({ p: Number(row.probability), o: row.outcome === 1 ? 1 : 0 });
    byModel.set(row.model_key, list);
    buckets.set(key, byModel);
  }

  console.log('horiz  evento           modelo        N     Brier    BSS vs 0.5');
  for (const [key, byModel] of [...buckets.entries()].sort()) {
    const coinflip = byModel.get('coinflip');
    const [horizon, eventKey] = key.split('|');
    for (const [modelKey, list] of [...byModel.entries()].sort()) {
      const brier = list.reduce((sum, item) => sum + (item.p - item.o) ** 2, 0) / list.length;
      let bss = '   -   ';
      if (coinflip && coinflip.length === list.length) {
        const paired: PairedScore[] = list.map((item, index) => ({
          modelProbability: item.p,
          baselineProbability: coinflip[index]?.p ?? 0.5,
          outcome: item.o,
        }));
        bss = pooledSkillScore(paired).toFixed(4).padStart(8);
      }
      console.log(
        `${(horizon ?? '').padEnd(6)} ${(eventKey ?? '').padEnd(16)} ${modelKey.padEnd(13)} ` +
          `${String(list.length).padStart(4)}  ${brier.toFixed(4)}  ${bss}`,
      );
    }
  }

  const pending = await query<{ n: string }>(
    `select count(*)::text as n from prediction p
     left join resolution r on r.prediction_id = p.id
     where r.prediction_id is null`,
  );
  console.log('');
  console.log(`predicciones aun sin vencer: ${pending[0]?.n ?? '0'}`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => {
    void closePool();
  });
