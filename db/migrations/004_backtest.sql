create table backtest_run (
  id bigserial primary key,
  label text not null,
  policy_version text not null,
  config jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  observations integer not null default 0,
  notes text
);

create table backtest_score (
  id bigserial primary key,
  run_id bigint not null references backtest_run (id) on delete cascade,
  instrument_id bigint not null references instrument (id),
  horizon text not null check (horizon in ('1d', '7d')),
  event_type text not null check (event_type in ('MAG', 'VOL', 'DIR')),
  event_key text not null,
  model_key text not null,
  model_version text not null,
  t0_date date not null,
  window_end_date date not null,
  probability numeric(6, 5) not null,
  outcome smallint check (outcome in (0, 1)),
  void_reason text,
  brier numeric(12, 10)
);

create index backtest_score_run on backtest_score (run_id);
create index backtest_score_slice on backtest_score
  (run_id, instrument_id, horizon, event_key, model_key);
create index backtest_score_model on backtest_score (run_id, model_key, event_type);
create index backtest_score_date on backtest_score (run_id, t0_date);
