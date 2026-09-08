import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { POLICY_VERSION, RESOLVER_VERSION, resolverMajor } from './policy.js';

const here = dirname(fileURLToPath(import.meta.url));
const docPath = join(here, '..', '..', 'docs', 'RESOLUTION-POLICY.md');
const doc = readFileSync(docPath, 'utf8');

describe('version de la politica', () => {
  it('el titulo del documento congelado coincide con el codigo', () => {
    expect(doc).toMatch(new RegExp(`^# POL[IÍ]TICA DE RESOLUCI[OÓ]N — v${POLICY_VERSION}\\b`, 'm'));
  });

  it('la tabla de versionado del documento coincide con el codigo', () => {
    expect(doc).toContain(`| Versión de esta política | \`${POLICY_VERSION}\` |`);
    expect(doc).toContain(`| \`resolver_version\` correspondiente | \`${RESOLVER_VERSION}\` |`);
  });

  it('el historial del documento tiene una entrada para la version vigente', () => {
    expect(doc).toMatch(new RegExp(`^\\| \`${POLICY_VERSION}\` \\|`, 'm'));
  });

  it('un cambio de politica arrastra el major del resolvedor', () => {
    expect(resolverMajor()).toBe(POLICY_VERSION);
  });

  it('las versiones tienen la forma esperada', () => {
    expect(POLICY_VERSION).toMatch(/^\d+$/);
    expect(RESOLVER_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('nadie ha vuelto a escribir la version a mano fuera de este modulo', () => {
    const sospechosos = [
      join(here, '..', 'resolve', 'resolver.ts'),
      join(here, '..', 'backtest', 'run.ts'),
      join(here, '..', 'snapshot', 'export.ts'),
    ];

    for (const file of sospechosos) {
      const source = readFileSync(file, 'utf8');
      expect(source).not.toMatch(/policyVersion: '\d+'/);
      expect(source).not.toMatch(/policy_version[^)]*values \([^)]*'\d+'/);
    }
  });
});
