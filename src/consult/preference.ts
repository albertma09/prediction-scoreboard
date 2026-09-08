export const MODEL_PREFERENCE_BY_EVENT: Record<string, readonly string[]> = {
  VOL: ['volCal', 'ewmaVol', 'climatology'],
  MAG: ['ewmaVol', 'climatology'],
  DIR: ['climatology'],
};

export const DEFAULT_MODEL_PREFERENCE: readonly string[] = ['ewmaVol', 'climatology'];

export function preferredRow<T extends { model_key: string; event_type: string }>(
  list: readonly T[],
): T | undefined {
  const first = list[0];
  if (first === undefined) {
    return undefined;
  }

  const order = MODEL_PREFERENCE_BY_EVENT[first.event_type] ?? DEFAULT_MODEL_PREFERENCE;

  for (const modelKey of order) {
    const found = list.find((row) => row.model_key === modelKey);
    if (found !== undefined) {
      return found;
    }
  }

  return undefined;
}
