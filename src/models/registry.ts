import { query } from '../db/pool.js';
import { canonicalJson, sha256 } from '../predictions/canonical.js';
import type { CanonicalObject } from '../predictions/canonical.js';
import { climatologyModel } from './climatology.js';
import { coinflipModel } from './coinflip.js';
import { ewmaVolModel } from './ewmaVol.js';
import type { Model } from './base.js';

const models = new Map<string, Model>([
  [coinflipModel.key, coinflipModel],
  [climatologyModel.key, climatologyModel],
  [ewmaVolModel.key, ewmaVolModel],
]);

export function allModels(): Model[] {
  return [...models.values()];
}

export function getModel(key: string): Model {
  const model = models.get(key);
  if (!model) {
    throw new Error(
      `modelo desconocido: ${key} (disponibles: ${[...models.keys()].join(', ')})`,
    );
  }
  return model;
}

export function computeCodeHash(model: Model): string {
  const params: CanonicalObject = {};
  for (const [name, value] of Object.entries(model.params)) {
    params[name] = String(value);
  }

  const fingerprint = canonicalJson({
    key: model.key,
    version: model.version,
    params,
    source: model.predict.toString(),
  });

  return sha256(fingerprint);
}

export async function registerModel(model: Model): Promise<number> {
  const codeHash = computeCodeHash(model);

  const existing = await query<{ id: number; code_hash: string }>(
    'select id, code_hash from model_version where model_key = $1 and version = $2',
    [model.key, model.version],
  );

  const previous = existing[0];

  if (previous) {
    if (previous.code_hash !== codeHash) {
      throw new Error(
        `el codigo de ${model.key}@${model.version} cambio sin subir la version\n` +
          `  hash registrado: ${previous.code_hash}\n` +
          `  hash actual:     ${codeHash}\n` +
          'sube la version del modelo: las predicciones ya emitidas se atribuyen a la version anterior',
      );
    }
    return previous.id;
  }

  const inserted = await query<{ id: number }>(
    `insert into model_version (model_key, version, params, code_hash, is_baseline)
     values ($1, $2, $3::jsonb, $4, $5)
     returning id`,
    [model.key, model.version, JSON.stringify(model.params), codeHash, model.isBaseline],
  );

  const id = inserted[0]?.id;
  if (id === undefined) {
    throw new Error(`no se pudo registrar el modelo ${model.key}@${model.version}`);
  }
  return id;
}

export async function registerAllModels(): Promise<Map<string, number>> {
  const ids = new Map<string, number>();
  for (const model of allModels()) {
    ids.set(model.key, await registerModel(model));
  }
  return ids;
}
