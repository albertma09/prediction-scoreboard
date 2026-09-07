import { closePool, query } from '../db/pool.js';
import { resolvePending, RESOLVER_VERSION } from '../resolve/resolver.js';

async function main(): Promise<void> {
  const limitArg = process.argv.find((arg) => arg.startsWith('--limit='));
  const limit = limitArg === undefined ? 5000 : Number(limitArg.split('=')[1]);

  const report = await resolvePending(limit);

  console.log(`resolvedor ${RESOLVER_VERSION}`);
  console.log(`  resueltas : ${report.resolved}`);
  console.log(`  nulas     : ${report.voided}`);
  console.log(`  aplazadas : ${report.deferred}`);

  if (report.voided > 0) {
    const reasons = await query<{ void_reason: string; n: string }>(
      `select void_reason, count(*)::text as n
       from resolution where void_reason is not null
       group by void_reason order by count(*) desc`,
    );
    for (const row of reasons) {
      console.log(`    ${row.void_reason}: ${row.n}`);
    }
  }

  const pending = await query<{ n: string }>(
    `select count(*)::text as n
     from prediction p
     left join resolution r on r.prediction_id = p.id
     where r.prediction_id is null`,
  );
  console.log(`  sin vencer: ${pending[0]?.n ?? '0'}`);

  for (const detail of report.details.filter((item) => item.deferred).slice(0, 5)) {
    console.log(
      `  aplazada: prediccion ${detail.predictionId} (${detail.symbol} ${detail.horizon}) ` +
        'todavia no hay barras para su ventana',
    );
  }
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => {
    void closePool();
  });
