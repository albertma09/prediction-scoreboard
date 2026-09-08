import { describe, expect, it } from 'vitest';
import { FAILURE_ABORT_RATIO, verdictFor } from './verdict.js';

describe('verdictFor', () => {
  it('sin fallos, todo bien', () => {
    expect(verdictFor(0, 89)).toBe('ok');
    expect(verdictFor(0, 1)).toBe('ok');
  });

  it('el fallo suelto que provoco el apagon ya no tumba el ciclo', () => {
    expect(verdictFor(1, 89)).toBe('aislados');
  });

  it('aguanta hasta la cuarta parte de los objetivos', () => {
    expect(verdictFor(22, 89)).toBe('aislados');
    expect(verdictFor(23, 89)).toBe('averia');
  });

  it('una averia general para el ciclo', () => {
    expect(verdictFor(89, 89)).toBe('averia');
    expect(verdictFor(50, 89)).toBe('averia');
  });

  it('con un solo objetivo, su fallo es una averia', () => {
    expect(verdictFor(1, 1)).toBe('averia');
  });

  it('con cinco trackeados, uno caido sigue siendo aislado: los otros cuatro deben emitir', () => {
    expect(verdictFor(1, 5)).toBe('aislados');
    expect(verdictFor(2, 5)).toBe('averia');
  });

  it('la separacion entre lo critico y lo cosmetico la hace el workflow, no el umbral', () => {
    expect(verdictFor(1, 5)).toBe(verdictFor(1, 89));
  });

  it('respeta el umbral declarado', () => {
    expect(FAILURE_ABORT_RATIO).toBe(0.25);
    const targets = 100;
    expect(verdictFor(25, targets)).toBe('aislados');
    expect(verdictFor(26, targets)).toBe('averia');
  });

  it('nunca devuelve ok si hubo algun fallo', () => {
    for (let failures = 1; failures <= 89; failures += 1) {
      expect(verdictFor(failures, 89)).not.toBe('ok');
    }
  });
});
