create extension if not exists pg_trgm;

create table instrument (
  id bigserial primary key,
  symbol text not null unique,
  name text not null,
  asset_class text not null check (asset_class in ('crypto', 'equity', 'etf', 'index', 'fx')),
  provider text not null,
  provider_symbol text not null,
  exchange text,
  currency text not null default 'USD',
  session_tz text not null default 'UTC',
  is_tracked boolean not null default false,
  tracked_since timestamptz,
  created_at timestamptz not null default now(),
  constraint instrument_provider_symbol_unique unique (provider, provider_symbol),
  constraint instrument_tracked_needs_date check (is_tracked = false or tracked_since is not null)
);

create index instrument_symbol_trgm on instrument using gin (symbol gin_trgm_ops);
create index instrument_name_trgm on instrument using gin (name gin_trgm_ops);
create index instrument_tracked on instrument (is_tracked) where is_tracked = true;

create table instrument_alias (
  instrument_id bigint not null references instrument (id) on delete cascade,
  alias text not null,
  primary key (instrument_id, alias)
);

create index instrument_alias_trgm on instrument_alias using gin (alias gin_trgm_ops);

create table ohlcv_bar (
  instrument_id bigint not null references instrument (id),
  bar_interval text not null check (bar_interval in ('1d')),
  bar_date date not null,
  open numeric(20, 8) not null,
  high numeric(20, 8) not null,
  low numeric(20, 8) not null,
  close numeric(20, 8) not null,
  adj_close numeric(20, 8) not null,
  volume numeric(28, 8),
  provider text not null,
  ingested_at timestamptz not null default now(),
  adj_close_updated_at timestamptz,
  primary key (instrument_id, bar_interval, bar_date),
  constraint ohlcv_bar_sane_range check (
    high >= low
    and close >= low and close <= high
    and open >= low and open <= high
    and open > 0 and close > 0 and adj_close > 0
  )
);

create index ohlcv_bar_recent on ohlcv_bar (instrument_id, bar_date desc);

create table ingest_run (
  id bigserial primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  provider text not null,
  instruments_count integer not null default 0,
  bars_written integer not null default 0,
  status text not null default 'running' check (status in ('running', 'ok', 'partial', 'failed')),
  error text
);

create table model_version (
  id bigserial primary key,
  model_key text not null,
  version text not null,
  params jsonb not null default '{}'::jsonb,
  code_hash text not null,
  is_baseline boolean not null default false,
  created_at timestamptz not null default now(),
  constraint model_version_unique unique (model_key, version)
);

create table prediction (
  id bigserial primary key,
  uuid uuid not null unique default gen_random_uuid(),
  instrument_id bigint not null references instrument (id),
  model_version_id bigint not null references model_version (id),
  event_type text not null check (event_type in ('MAG', 'VOL', 'DIR')),
  event_key text not null,
  event_params jsonb not null,
  horizon text not null check (horizon in ('1d', '7d')),
  t0_utc timestamptz not null,
  window_end_utc timestamptz not null,
  probability numeric(6, 5) not null check (probability >= 0.001 and probability <= 0.999),
  features_hash text not null,
  origin text not null check (origin in ('scheduled', 'manual')),
  payload_canonical text not null,
  content_hash text not null unique,
  prev_hash text not null,
  chain_hash text not null unique,
  created_at timestamptz not null default now(),
  constraint prediction_window_after_t0 check (window_end_utc > t0_utc),
  constraint prediction_unique_emission unique (instrument_id, model_version_id, event_key, horizon, t0_utc)
);

create index prediction_pending on prediction (window_end_utc);
create index prediction_instrument_window on prediction (instrument_id, window_end_utc desc);
create index prediction_model on prediction (model_version_id);

create table resolution (
  prediction_id bigint primary key references prediction (id),
  outcome smallint not null check (outcome in (0, 1)),
  resolved_at timestamptz not null default now(),
  resolution_inputs jsonb not null,
  inputs_hash text not null,
  resolver_version text not null
);

create table score (
  prediction_id bigint primary key references prediction (id),
  brier numeric(12, 10) not null,
  baseline_climatology_prob numeric(6, 5),
  baseline_climatology_brier numeric(12, 10),
  baseline_coinflip_brier numeric(12, 10) not null,
  evaluator_version text not null,
  computed_at timestamptz not null default now()
);

create table resolution_anomaly (
  id bigserial primary key,
  instrument_id bigint not null references instrument (id),
  bar_interval text not null,
  bar_date date not null,
  field text not null,
  stored_value numeric(20, 8),
  provider_value numeric(20, 8),
  detected_at timestamptz not null default now(),
  note text
);

create index resolution_anomaly_instrument on resolution_anomaly (instrument_id, bar_date desc);

create table ledger_head (
  id smallint primary key default 1 check (id = 1),
  head_hash text not null,
  prediction_count bigint not null default 0,
  updated_at timestamptz not null default now()
);

insert into ledger_head (id, head_hash, prediction_count)
values (1, repeat('0', 64), 0);

create table ledger_anchor (
  id bigserial primary key,
  chain_head_hash text not null,
  prediction_count bigint not null,
  anchored_at timestamptz not null default now(),
  external_ref text
);

create or replace function forbid_mutation() returns trigger language plpgsql as $$
begin
  raise exception 'append_only_violation: % on %.% is forbidden',
    tg_op, tg_table_schema, tg_table_name
    using errcode = 'restrict_violation';
end;
$$;

create trigger prediction_append_only
  before update or delete on prediction
  for each row execute function forbid_mutation();

create trigger resolution_append_only
  before update or delete on resolution
  for each row execute function forbid_mutation();

create trigger ledger_anchor_append_only
  before update or delete on ledger_anchor
  for each row execute function forbid_mutation();

create or replace function ohlcv_bar_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'append_only_violation: delete on ohlcv_bar is forbidden'
      using errcode = 'restrict_violation';
  end if;
  if new.open <> old.open
    or new.high <> old.high
    or new.low <> old.low
    or new.close <> old.close
    or new.bar_date <> old.bar_date
    or new.instrument_id <> old.instrument_id then
    raise exception 'append_only_violation: raw ohlc fields are immutable'
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

create trigger ohlcv_bar_immutable_raw
  before update or delete on ohlcv_bar
  for each row execute function ohlcv_bar_guard();
