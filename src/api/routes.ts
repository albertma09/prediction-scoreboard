import { Router } from 'express';
import { query } from '../db/pool.js';
import { getInstrumentBySymbol, listTrackedInstruments } from '../instruments/catalog.js';
import { searchInstruments } from '../instruments/search.js';
import {
  buildSliceReports,
  calibrationByEvent,
  calibrationFor,
  loadBacktestScores,
} from '../eval/report.js';
import type { CalibrationBin } from '../eval/brier.js';
import type { SliceReport } from '../eval/report.js';
import { readHead, verify } from '../ledger/ledger.js';
import { TtlCache } from './cache.js';

const scoreboardCache = new TtlCache<{
  runId: number;
  label: string;
  finishedAt: string | null;
  observations: number;
  slices: SliceReport[];
}>(10 * 60_000);

const calibrationCache = new TtlCache<{
  bins: CalibrationBin[];
  byEvent: Record<string, CalibrationBin[]>;
}>(10 * 60_000);

async function latestBacktestRun(): Promise<{
  id: number;
  label: string;
  finished_at: string | null;
  observations: number;
} | null> {
  const rows = await query<{
    id: number;
    label: string;
    finished_at: string | null;
    observations: number;
  }>(
    `select id, label, finished_at::text as finished_at, observations
     from backtest_run
     where finished_at is not null
     order by finished_at desc
     limit 1`,
  );
  return rows[0] ?? null;
}

export function buildRouter(): Router {
  const router = Router();

  router.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'prediction-scoreboard', version: '0.1.0' });
  });

  router.get('/search', async (req, res, next) => {
    try {
      const q = typeof req.query.q === 'string' ? req.query.q : '';
      if (q.trim().length === 0) {
        res.json({ query: q, results: [] });
        return;
      }
      const results = await searchInstruments(q, 12);
      res.json({
        query: q,
        results: results.map((result) => ({
          symbol: result.symbol,
          name: result.name,
          assetClass: result.assetClass,
          exchange: result.exchange,
          isTracked: result.isTracked,
          scoredCount: result.scoredCount,
          trackRecord: result.isTracked
            ? result.scoredCount === 0
              ? 'tracked_no_history'
              : 'tracked_with_history'
            : 'not_tracked',
          origin: result.origin,
        })),
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/tracked', async (_req, res, next) => {
    try {
      const instruments = await listTrackedInstruments();
      res.json({
        instruments: instruments.map((instrument) => ({
          symbol: instrument.symbol,
          name: instrument.name,
          assetClass: instrument.asset_class,
          exchange: instrument.exchange,
          currency: instrument.currency,
          trackedSince: instrument.tracked_since,
        })),
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/instrument/:symbol', async (req, res, next) => {
    try {
      const symbol = req.params.symbol;
      const instrument = await getInstrumentBySymbol(symbol);

      if (!instrument) {
        res.status(404).json({ error: 'instrumento no encontrado en el catalogo', symbol });
        return;
      }

      const bars = await query<{ bar_date: string; close: string; adj_close: string }>(
        `select bar_date::text as bar_date, close::text, adj_close::text
         from ohlcv_bar
         where instrument_id = $1 and bar_interval = '1d'
         order by bar_date desc
         limit 180`,
        [instrument.id],
      );

      const livePredictions = await query<{
        id: number;
        event_key: string;
        event_type: string;
        horizon: string;
        probability: string;
        model_key: string;
        model_version: string;
        t0_utc: string;
        window_end_utc: string;
        chain_hash: string;
        outcome: number | null;
        void_reason: string | null;
      }>(
        `select p.id, p.event_key, p.event_type, p.horizon, p.probability::text,
                m.model_key, m.version as model_version,
                p.t0_utc::text, p.window_end_utc::text, p.chain_hash,
                r.outcome, r.void_reason
         from prediction p
         join model_version m on m.id = p.model_version_id
         left join resolution r on r.prediction_id = p.id
         where p.instrument_id = $1
         order by p.t0_utc desc, p.event_key
         limit 200`,
        [instrument.id],
      );

      const backtest = await latestBacktestRun();
      let backtestSummary: unknown = null;

      if (backtest) {
        const rows = await query<{
          horizon: string;
          event_key: string;
          model_key: string;
          n: string;
          base_rate: string;
          mean_brier: string;
        }>(
          `select horizon, event_key, model_key,
                  count(*)::text as n,
                  avg(outcome)::text as base_rate,
                  avg(brier)::text as mean_brier
           from backtest_score
           where run_id = $1 and instrument_id = $2 and outcome is not null
           group by horizon, event_key, model_key
           order by horizon, event_key, model_key`,
          [backtest.id, instrument.id],
        );

        backtestSummary = {
          source: 'backtest',
          runId: backtest.id,
          label: backtest.label,
          rows: rows.map((row) => ({
            horizon: row.horizon,
            eventKey: row.event_key,
            modelKey: row.model_key,
            count: Number(row.n),
            baseRate: Number(row.base_rate),
            meanBrier: Number(row.mean_brier),
          })),
        };
      }

      res.json({
        instrument: {
          symbol: instrument.symbol,
          name: instrument.name,
          assetClass: instrument.asset_class,
          exchange: instrument.exchange,
          currency: instrument.currency,
          provider: instrument.provider,
          isTracked: instrument.is_tracked,
          trackedSince: instrument.tracked_since,
        },
        prices: bars
          .map((bar) => ({
            barDate: bar.bar_date,
            close: Number(bar.close),
            adjClose: Number(bar.adj_close),
          }))
          .reverse(),
        ledger: {
          source: 'ledger',
          scoredCount: livePredictions.filter((row) => row.outcome !== null).length,
          predictions: livePredictions.map((row) => ({
            id: row.id,
            eventKey: row.event_key,
            eventType: row.event_type,
            horizon: row.horizon,
            probability: Number(row.probability),
            model: `${row.model_key}@${row.model_version}`,
            t0Utc: row.t0_utc,
            windowEndUtc: row.window_end_utc,
            chainHash: row.chain_hash,
            outcome: row.outcome,
            voidReason: row.void_reason,
          })),
        },
        backtest: backtestSummary,
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/scoreboard', async (_req, res, next) => {
    try {
      const run = await latestBacktestRun();
      if (!run) {
        res.json({ source: 'backtest', available: false, slices: [] });
        return;
      }

      const payload = await scoreboardCache.resolve(String(run.id), async () => {
        const rows = await loadBacktestScores(run.id);
        return {
          runId: run.id,
          label: run.label,
          finishedAt: run.finished_at,
          observations: run.observations,
          slices: buildSliceReports(rows, { perSymbol: false, bootstrapIterations: 600 }),
        };
      });

      res.json({ source: 'backtest', available: true, ...payload });
    } catch (error) {
      next(error);
    }
  });

  router.get('/scoreboard/live', async (_req, res, next) => {
    try {
      const rows = await query<{
        event_key: string;
        horizon: string;
        model_key: string;
        n: string;
        scored: string;
        voided: string;
      }>(
        `select p.event_key, p.horizon, m.model_key,
                count(*)::text as n,
                count(r.outcome)::text as scored,
                count(r.void_reason)::text as voided
         from prediction p
         join model_version m on m.id = p.model_version_id
         left join resolution r on r.prediction_id = p.id
         group by p.event_key, p.horizon, m.model_key
         order by p.horizon, p.event_key, m.model_key`,
      );

      res.json({
        source: 'ledger',
        available: rows.length > 0,
        note: 'el track record real solo cuenta predicciones del ledger, nunca del backtest',
        slices: rows.map((row) => ({
          eventKey: row.event_key,
          horizon: row.horizon,
          modelKey: row.model_key,
          emitted: Number(row.n),
          scored: Number(row.scored),
          voided: Number(row.voided),
        })),
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/calibration/:modelKey', async (req, res, next) => {
    try {
      const modelKey = req.params.modelKey;
      const run = await latestBacktestRun();
      if (!run) {
        res.json({ source: 'backtest', available: false, bins: [] });
        return;
      }

      const payload = await calibrationCache.resolve(`${run.id}:${modelKey}`, async () => {
        const rows = await loadBacktestScores(run.id);
        return {
          bins: calibrationFor(rows, modelKey, 10),
          byEvent: calibrationByEvent(rows, modelKey, 10),
        };
      });

      res.json({
        source: 'backtest',
        available: true,
        modelKey,
        runId: run.id,
        bins: payload.bins,
        byEvent: payload.byEvent,
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/ledger/verify', async (_req, res, next) => {
    try {
      const [report, head] = await Promise.all([verify(), readHead()]);
      res.json({
        ok: report.ok,
        checked: report.checked,
        declaredHead: head.headHash,
        recomputedHead: report.headHash,
        breaks: report.breaks,
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
