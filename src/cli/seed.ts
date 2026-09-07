import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { closePool } from '../db/pool.js';
import { instrumentSeedSchema, upsertInstrument } from '../instruments/catalog.js';

const here = dirname(fileURLToPath(import.meta.url));
const seedPath = join(here, '..', '..', 'data', 'seed-instruments.json');

async function main(): Promise<void> {
  const raw = await readFile(seedPath, 'utf8');
  const seeds = z.array(instrumentSeedSchema).parse(JSON.parse(raw));

  const symbols = new Set<string>();
  for (const seed of seeds) {
    if (symbols.has(seed.symbol)) {
      throw new Error(`simbolo duplicado en la semilla: ${seed.symbol}`);
    }
    symbols.add(seed.symbol);
  }

  let tracked = 0;
  for (const seed of seeds) {
    await upsertInstrument(seed);
    if (seed.tracked) {
      tracked += 1;
    }
  }

  console.log(`catalogo sembrado: ${seeds.length} instrumentos, ${tracked} trackeados`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => {
    void closePool();
  });
