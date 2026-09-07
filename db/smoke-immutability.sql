create or replace function expect_fail(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return 'TEST FALLIDO -- se permitio: ' || stmt;
exception when others then
  return 'bloqueado ok  -- ' || split_part(sqlerrm, E'\n', 1);
end;
$$;

create or replace function expect_ok(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return 'permitido ok  -- ' || stmt;
exception when others then
  return 'TEST FALLIDO -- se bloqueo: ' || split_part(sqlerrm, E'\n', 1);
end;
$$;

insert into instrument (symbol, name, asset_class, provider, provider_symbol, currency, session_tz, is_tracked, tracked_since)
values ('BTCUSD', 'Bitcoin', 'crypto', 'binance', 'BTCUSDT', 'USD', 'UTC', true, now())
on conflict do nothing;

insert into model_version (model_key, version, params, code_hash, is_baseline)
values ('coinflip', '1.0.0', '{}'::jsonb, repeat('a', 64), true)
on conflict do nothing;

insert into ohlcv_bar (instrument_id, bar_interval, bar_date, open, high, low, close, adj_close, volume, provider)
select id, '1d', date '2026-09-01', 100, 110, 95, 105, 105, 1000, 'binance'
from instrument where symbol = 'BTCUSD'
on conflict do nothing;

insert into prediction (
  instrument_id, model_version_id, event_type, event_key, event_params, horizon,
  t0_utc, window_end_utc, probability, features_hash, origin,
  payload_canonical, content_hash, prev_hash, chain_hash
)
select i.id, m.id, 'DIR', 'DIR:', '{}'::jsonb, '1d',
  timestamptz '2026-09-01 00:00:00+00', timestamptz '2026-09-02 00:00:00+00',
  0.5, repeat('b', 64), 'scheduled',
  '{"probability":0.5}', repeat('c', 64), repeat('0', 64), repeat('d', 64)
from instrument i, model_version m
where i.symbol = 'BTCUSD' and m.model_key = 'coinflip'
on conflict do nothing;

\echo '=== inmutabilidad de prediction ==='
select expect_fail('update prediction set probability = 0.9 where id > 0');
select expect_fail('delete from prediction where id > 0');

\echo '=== inmutabilidad de ohlcv_bar ==='
select expect_fail('delete from ohlcv_bar where instrument_id > 0');
select expect_fail('update ohlcv_bar set close = 999 where instrument_id > 0');
select expect_ok('update ohlcv_bar set adj_close = 104.5, adj_close_updated_at = now() where instrument_id > 0');

\echo '=== validaciones de dominio ==='
select expect_fail($q$insert into prediction (instrument_id, model_version_id, event_type, event_key, event_params, horizon, t0_utc, window_end_utc, probability, features_hash, origin, payload_canonical, content_hash, prev_hash, chain_hash) select i.id, m.id, 'DIR', 'DIR:', '{}'::jsonb, '1d', now(), now() + interval '1 day', 1.0, repeat('e',64), 'scheduled', '{}', repeat('f',64), repeat('0',64), repeat('9',64) from instrument i, model_version m where i.symbol='BTCUSD' and m.model_key='coinflip'$q$) as probabilidad_1_0;
select expect_fail($q$insert into prediction (instrument_id, model_version_id, event_type, event_key, event_params, horizon, t0_utc, window_end_utc, probability, features_hash, origin, payload_canonical, content_hash, prev_hash, chain_hash) select i.id, m.id, 'DIR', 'DIR:', '{}'::jsonb, '1d', now(), now() - interval '1 day', 0.5, repeat('e',64), 'scheduled', '{}', repeat('7',64), repeat('0',64), repeat('8',64) from instrument i, model_version m where i.symbol='BTCUSD' and m.model_key='coinflip'$q$) as ventana_invertida;
select expect_fail($q$insert into ohlcv_bar (instrument_id, bar_interval, bar_date, open, high, low, close, adj_close, provider) select id, '1d', date '2026-09-05', 100, 90, 95, 105, 105, 'binance' from instrument where symbol='BTCUSD'$q$) as barra_incoherente;
select expect_fail($q$insert into instrument (symbol, name, asset_class, provider, provider_symbol, is_tracked) values ('XX','X','equity','yahoo','XX', true)$q$) as tracked_sin_fecha;

\echo '=== estado del ledger ==='
select head_hash, prediction_count from ledger_head;

drop function expect_fail(text);
drop function expect_ok(text);
