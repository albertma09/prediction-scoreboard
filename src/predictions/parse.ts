import { z } from 'zod';
import type { EventSpec, EventType, Horizon } from './events.js';

const magParamsSchema = z.object({
  kSigma: z.number().positive(),
  sigmaWindow: z.number().int().positive(),
  thresholdAbs: z.number().positive().lt(1),
});

const volParamsSchema = z.object({
  rvPrevious: z.number().nonnegative(),
  windowBars: z.number().int().positive(),
});

export function parseEventSpec(eventType: string, params: unknown): EventSpec {
  switch (eventType) {
    case 'MAG':
      return { type: 'MAG', params: magParamsSchema.parse(params) };
    case 'VOL':
      return { type: 'VOL', params: volParamsSchema.parse(params) };
    case 'DIR':
      return { type: 'DIR', params: {} };
    default:
      throw new Error(`tipo de evento desconocido: ${eventType}`);
  }
}

export function parseEventType(value: string): EventType {
  if (value === 'MAG' || value === 'VOL' || value === 'DIR') {
    return value;
  }
  throw new Error(`tipo de evento desconocido: ${value}`);
}

export function parseHorizon(value: string): Horizon {
  if (value === '1d' || value === '7d') {
    return value;
  }
  throw new Error(`horizonte desconocido: ${value}`);
}
