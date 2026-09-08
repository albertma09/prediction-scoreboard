export type AssetClass = 'crypto' | 'equity' | 'etf' | 'index' | 'fx';

export type InstrumentCategory = 'crypto' | 'commodity' | 'equity' | 'etf' | 'index';

export interface CatalogEntry {
  symbol: string;
  slug: string;
  name: string;
  assetClass: AssetClass;
  category: InstrumentCategory;
  exchange: string | null;
  currency: string;
  isTracked: boolean;
  scoredCount: number;
  hasConsultation: boolean;
  aliases: string[];
}

export interface SearchHit extends CatalogEntry {
  score: number;
}

export interface MetaResponse {
  snapshotVersion: string;
  payloadSchemaVersion: string;
  policyVersion: string;
  generatedAt: string;
  instruments: number;
  trackedInstruments: number;
  categories: Record<InstrumentCategory, number>;
  ledgerPredictions: number;
  ledgerOk: boolean;
  backtestObservations: number;
  backtestSlices: number;
  emissionRuns: number;
  emissionSkipped: number;
  emissionFailed: number;
  models: string[];
}

export interface PriceBar {
  barDate: string;
  close: number;
  adjClose: number;
}

export interface ConsultationView {
  horizon: string;
  eventType: string;
  eventKey: string;
  eventParams: Record<string, unknown>;
  bestModelKey: string;
  probability: number;
  climatologyProbability: number | null;
  computedAt: string;
  baseBarDate: string;
}

export interface LedgerPrediction {
  id: number;
  eventKey: string;
  eventType: string;
  horizon: string;
  probability: number;
  model: string;
  t0Utc: string;
  windowEndUtc: string;
  chainHash: string;
  outcome: number | null;
  voidReason: string | null;
}

export interface BacktestRow {
  horizon: string;
  eventKey: string;
  modelKey: string;
  count: number;
  baseRate: number;
  meanBrier: number;
}

export interface InstrumentResponse {
  instrument: {
    symbol: string;
    slug: string;
    name: string;
    assetClass: AssetClass;
    exchange: string | null;
    currency: string;
    provider: string;
    isTracked: boolean;
    trackedSince: string | null;
  };
  prices: PriceBar[];
  consultation: {
    source: 'consultation';
    available: boolean;
    note: string;
    views: ConsultationView[];
  };
  ledger: {
    source: 'ledger';
    scoredCount: number;
    predictions: LedgerPrediction[];
  };
  backtest: {
    source: 'backtest';
    runId: number;
    label: string;
    rows: BacktestRow[];
  } | null;
}

export interface Slice {
  symbol: string | null;
  assetClass: AssetClass | null;
  horizon: string;
  eventType: string;
  eventKey: string;
  modelKey: string;
  count: number;
  baseRate: number;
  modelBrier: number;
  climatologyBrier: number | null;
  coinflipBrier: number;
  bssVsClimatology: number | null;
  bssVsCoinflip: number;
  bssVsCoinflipLower: number;
  bssVsCoinflipUpper: number;
  crossesZero: boolean;
  effectiveObservations: number;
  reliability: number;
  withinBinResidual: number;
  resolution: number;
  uncertainty: number;
}

export interface ScoreboardResponse {
  source: 'backtest';
  available: boolean;
  runId?: number;
  label?: string;
  finishedAt?: string | null;
  observations?: number;
  slices: Slice[];
}

export interface LiveSlice {
  eventKey: string;
  horizon: string;
  modelKey: string;
  emitted: number;
  scored: number;
  voided: number;
  meanBrier: number | null;
}

export interface LiveScoreboardResponse {
  source: 'ledger';
  available: boolean;
  note: string;
  slices: LiveSlice[];
}

export interface CalibrationBin {
  lowerBound: number;
  upperBound: number;
  count: number;
  meanForecast: number;
  observedFrequency: number;
}

export interface CalibrationResponse {
  source: 'backtest';
  available: boolean;
  modelKey?: string;
  runId?: number;
  bins: CalibrationBin[];
  byEvent?: Record<string, CalibrationBin[]>;
}

export interface EmissionRun {
  slotDate: string;
  status: string;
  emitted: number;
  leadMinutes: number | null;
}

export interface EmissionsResponse {
  runs: EmissionRun[];
  attempted: number;
  skipped: number;
  failed: number;
  skipRate: number | null;
  note: string;
}

export interface LedgerVerifyResponse {
  ok: boolean;
  checked: number;
  declaredHead: string;
  recomputedHead: string;
  breaks: Array<{
    kind: string;
    predictionId: number | null;
    field: string | null;
    expected: string;
    found: string;
    detail: string;
  }>;
}
