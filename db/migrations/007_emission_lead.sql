alter table emission_run add column lead_minutes integer;

alter table emission_run add column target_slot date;

update emission_run set target_slot = slot_date where target_slot is null;

alter table emission_run drop constraint emission_run_status_check;

alter table emission_run add constraint emission_run_status_check
  check (status in ('running', 'ok', 'partial', 'skipped_late', 'skipped_slot_open', 'failed'));
