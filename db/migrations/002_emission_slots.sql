alter table prediction drop constraint prediction_unique_emission;

alter table prediction add constraint prediction_unique_emission
  unique (instrument_id, model_version_id, event_key, horizon, window_end_utc);

alter table prediction add constraint prediction_t0_is_slot
  check (t0_utc = (date_trunc('day', t0_utc at time zone 'UTC') at time zone 'UTC'));

create index prediction_t0 on prediction (t0_utc desc);
