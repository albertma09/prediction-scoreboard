import type { Model } from './base.js';

export const coinflipModel: Model = {
  key: 'coinflip',
  version: '1.0.0',
  params: {},
  isBaseline: true,

  supports(): boolean {
    return true;
  },

  minimumHistory(): number {
    return 0;
  },

  predict(): number {
    return 0.5;
  },
};
