import { closePool, query } from '../db/pool.js';
import { pooledSkillScore } from '../eval/brier.js';
import type { PairedScore } from '../eval/brier.js';

interface ScoredRow {
  horizon: string;
  event_key: string;
  model_key: string;
  t0_date: string;
  probability: string;
  outcome: number;
}

async function main(): Promise<void> {
  const rows = await query<ScoredRow>(
    `select p.horizon, p.event_key, m.model_key,
            (p.t0_utc at time zone 'UTC')::date::text as t0_date,
            p.probability::text, r.outcome
     from prediction p
     join model_version m on m.id = p.model_version_id
     join resolution r on r.prediction_id = p.id
     where r.outcome is not null
     order by p.horizon, p.event_key, m.model_key, p.t0_utc`,
  );

  if (rows.length === 0) {
    console.log('el registro no tiene ninguna prediccion puntuada todavia.');
    console.log('el track record real empieza cuando el cron de emision arranca.');
    return;
  }

  const buckets = new Map<string, Map<string, Map<string, { p: number; o: 0 | 1 }>>>();

  for (const row of rows) {
    const key = `${row.horizon}|${row.event_key}`;
    const byModel = buckets.get(key) ?? new Map();
    const byDate = byModel.get(row.model_key) ?? new Map();
    byDate.set(row.t0_date, {
      p: Number(row.probability),
      o: row.outcome === 1 ? 1 : 0,
    });
    byModel.set(row.model_key, byDate);
    buckets.set(key, byModel);
  }

  console.log(`predicciones puntuadas en el registro: ${rows.length}`);
  console.log('');
  console.log('horiz  evento           modelo           N   tasaBase   Brier    BSS vs 0.5');

  for (const [key, byModel] of [...buckets.entries()].sort()) {
    const [horizon, eventKey] = key.split('|');
    const coinflip = byModel.get('coinflip');

    for (const [modelKey, byDate] of [...byModel.entries()].sort()) {
      const items = [...byDate.entries()];
      const brier =
        items.reduce((sum, [, item]) => sum + (item.p - item.o) ** 2, 0) / items.length;
      const baseRate = items.reduce((sum, [, item]) => sum + item.o, 0) / items.length;

      let bss = '    -   ';
      if (coinflip) {
        const paired: PairedScore[] = [];
        for (const [date, item] of items) {
          const counterpart = coinflip.get(date);
          if (counterpart === undefined) {
            continue;
          }
          paired.push({
            modelProbability: item.p,
            baselineProbability: counterpart.p,
            outcome: item.o,
          });
        }
        if (paired.length > 0) {
          bss = pooledSkillScore(paired).toFixed(4).padStart(8);
        }
      }

      console.log(
        `${(horizon ?? '').padEnd(6)} ${(eventKey ?? '').padEnd(16)} ${modelKey.padEnd(13)} ` +
          `${String(items.length).padStart(5)}  ${baseRate.toFixed(4)}  ${brier.toFixed(4)}  ${bss}`,
      );
    }
  }

  console.log('');
  console.log(
    'recordatorio: con pocas observaciones estos numeros no distinguen habilidad de suerte.',
  );
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => {
    void closePool();
  });
