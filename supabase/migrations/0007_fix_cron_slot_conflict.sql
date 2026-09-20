-- 0007_fix_cron_slot_conflict.sql
-- Fix ON CONFLICT target for scheduled_slot in claim_cron_run and create full unique index

drop index if exists scrape_runs_slot_uq;
create unique index if not exists scrape_runs_slot_uq on scrape_runs (scheduled_slot);

create or replace function claim_cron_run(p_slot timestamptz, p_lease_seconds int default 1800)
returns uuid
language plpgsql
security definer
as $$
declare
  v_run_id uuid;
begin
  insert into scrape_runs (trigger, scheduled_slot, lease_until, status)
  values ('cron', p_slot, now() + (p_lease_seconds || ' seconds')::interval, 'running')
  on conflict (scheduled_slot) do nothing
  returning id into v_run_id;

  return v_run_id;
end;
$$;
