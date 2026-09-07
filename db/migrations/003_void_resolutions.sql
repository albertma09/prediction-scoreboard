alter table resolution alter column outcome drop not null;

alter table resolution add column void_reason text;

alter table resolution add constraint resolution_void_reason_known
  check (
    void_reason is null
    or void_reason in ('no_bars_in_window', 'insufficient_vol_bars', 'no_base_bar')
  );

alter table resolution add constraint resolution_outcome_xor_void
  check (
    (outcome is not null and void_reason is null)
    or (outcome is null and void_reason is not null)
  );

create index resolution_void on resolution (void_reason) where void_reason is not null;
