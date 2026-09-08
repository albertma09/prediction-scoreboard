export const FAILURE_ABORT_RATIO = 0.25;

export type IngestVerdict = 'ok' | 'aislados' | 'averia';

export function verdictFor(failures: number, targets: number): IngestVerdict {
  if (failures === 0) {
    return 'ok';
  }
  if (failures >= targets || failures / targets > FAILURE_ABORT_RATIO) {
    return 'averia';
  }
  return 'aislados';
}
