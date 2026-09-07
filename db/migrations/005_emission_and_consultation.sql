create table emission_run (
  id bigserial primary key,
  slot_date date not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running'
    check (status in ('running', 'ok', 'partial', 'skipped_late', 'failed')),
  emitted integer not null default 0,
  already_present integer not null default 0,
  skipped_no_session integer not null default 0,
  skipped_no_history integer not null default 0,
  minutes_late integer,
  error text,
  constraint emission_run_slot_unique unique (slot_date)
);

create index emission_run_slot on emission_run (slot_date desc);

create table consultation (
  id bigserial primary key,
  instrument_id bigint not null references instrument (id) on delete cascade,
  horizon text not null check (horizon in ('1d', '7d')),
  event_type text not null check (event_type in ('MAG', 'VOL', 'DIR')),
  event_key text not null,
  event_params jsonb not null,
  model_key text not null,
  model_version text not null,
  probability numeric(6, 5) not null,
  computed_at timestamptz not null default now(),
  base_bar_date date not null,
  history_bars integer not null,
  constraint consultation_unique unique (instrument_id, horizon, event_key, model_key)
);

create index consultation_instrument on consultation (instrument_id);

create table consultation_run (
  id bigserial primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  instruments_covered integer not null default 0,
  instruments_skipped integer not null default 0,
  rows_written integer not null default 0,
  status text not null default 'running' check (status in ('running', 'ok', 'partial', 'failed')),
  error text
);
