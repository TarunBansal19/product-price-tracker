-- 0002_rpc.sql
-- Atomic RPC functions for transactional scraper operations

-- 1. claim_cron_run: idempotent slot claim
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

-- 2. claim_manual_run: create non-slot run
create or replace function claim_manual_run(p_trigger text, p_lease_seconds int default 600)
returns uuid
language plpgsql
security definer
as $$
declare
  v_run_id uuid;
begin
  insert into scrape_runs (trigger, lease_until, status)
  values (p_trigger, now() + (p_lease_seconds || ' seconds')::interval, 'running')
  returning id into v_run_id;

  return v_run_id;
end;
$$;

-- 3. claim_product: lock product for execution
create or replace function claim_product(p_product_id uuid, p_lease_seconds int default 120)
returns boolean
language plpgsql
security definer
as $$
declare
  v_updated boolean;
begin
  update tracked_products
  set locked_until = now() + (p_lease_seconds || ' seconds')::interval
  where id = p_product_id
    and is_active = true
    and (locked_until is null or locked_until < now());

  return found;
end;
$$;

-- 4. release_product: clear product lease
create or replace function release_product(p_product_id uuid)
returns void
language plpgsql
security definer
as $$
begin
  update tracked_products
  set locked_until = null
  where id = p_product_id;
end;
$$;

-- 5. begin_attempt: log start of an attempt
create or replace function begin_attempt(
  p_run_id uuid,
  p_product_id uuid,
  p_attempt_no int,
  p_strategy text,
  p_version text
)
returns uuid
language plpgsql
security definer
as $$
declare
  v_attempt_id uuid;
begin
  insert into scrape_attempts (
    run_id,
    tracked_product_id,
    attempt_number,
    started_at,
    strategy,
    scraper_version
  )
  values (
    p_run_id,
    p_product_id,
    p_attempt_no,
    now(),
    p_strategy,
    p_version
  )
  returning id into v_attempt_id;

  return v_attempt_id;
end;
$$;

-- 6. finish_attempt_failed: record retried or failed attempt
create or replace function finish_attempt_failed(
  p_attempt_id uuid,
  p_outcome text,
  p_code text,
  p_message text,
  p_http_status int,
  p_debug jsonb
)
returns void
language plpgsql
security definer
as $$
declare
  v_started_at timestamptz;
  v_product_id uuid;
  v_duration int;
begin
  select started_at, tracked_product_id
  into v_started_at, v_product_id
  from scrape_attempts
  where id = p_attempt_id;

  if v_started_at is not null then
    v_duration := extract(epoch from (now() - v_started_at)) * 1000;
  end if;

  update scrape_attempts
  set finished_at = now(),
      duration_ms = v_duration,
      outcome = p_outcome,
      error_code = p_code,
      error_message = left(p_message, 500),
      http_status = p_http_status,
      debug = p_debug
  where id = p_attempt_id;

  update tracked_products
  set last_attempt_at = now(),
      consecutive_failed_jobs = case
        when p_outcome = 'failed' then consecutive_failed_jobs + 1
        else consecutive_failed_jobs
      end
  where id = v_product_id;
end;
$$;

-- 7. finish_attempt_success: atomically write observation + attempt + product update
create or replace function finish_attempt_success(
  p_attempt_id uuid,
  p_observation jsonb
)
returns uuid
language plpgsql
security definer
as $$
declare
  v_started_at timestamptz;
  v_product_id uuid;
  v_duration int;
  v_obs_id uuid;
begin
  select started_at, tracked_product_id
  into v_started_at, v_product_id
  from scrape_attempts
  where id = p_attempt_id;

  if v_started_at is not null then
    v_duration := extract(epoch from (now() - v_started_at)) * 1000;
  end if;

  -- 1. Mark attempt as success
  update scrape_attempts
  set finished_at = now(),
      duration_ms = v_duration,
      outcome = 'success',
      error_code = null,
      error_message = null
  where id = p_attempt_id;

  -- 2. Insert observation
  insert into price_observations (
    tracked_product_id,
    attempt_id,
    observed_at,
    price_minor,
    currency,
    stock_state,
    stock_quantity,
    list_price_minor,
    raw_price_text,
    raw_stock_text,
    price_source,
    cross_checked
  )
  values (
    v_product_id,
    p_attempt_id,
    (p_observation->>'observed_at')::timestamptz,
    (p_observation->>'price_minor')::bigint,
    p_observation->>'currency',
    p_observation->>'stock_state',
    (p_observation->>'stock_quantity')::int,
    (p_observation->>'list_price_minor')::bigint,
    p_observation->>'raw_price_text',
    p_observation->>'raw_stock_text',
    p_observation->>'price_source',
    (p_observation->>'cross_checked')::boolean
  )
  returning id into v_obs_id;

  -- 3. Update tracked product stats
  update tracked_products
  set last_attempt_at = now(),
      last_success_at = now(),
      consecutive_failed_jobs = 0
  where id = v_product_id;

  return v_obs_id;
end;
$$;

-- 8. finish_run: finalize scrape run
create or replace function finish_run(
  p_run_id uuid,
  p_status text,
  p_products_total int,
  p_products_ok int,
  p_products_failed int,
  p_note text
)
returns void
language plpgsql
security definer
as $$
begin
  update scrape_runs
  set status = p_status,
      finished_at = now(),
      products_total = p_products_total,
      products_ok = p_products_ok,
      products_failed = p_products_failed,
      note = p_note
  where id = p_run_id;
end;
$$;

-- 9. sweep_stale: clean up dead locks and crashed in-flight attempts
create or replace function sweep_stale()
returns jsonb
language plpgsql
security definer
as $$
declare
  v_attempts_swept int;
  v_runs_swept int;
  v_locks_cleared int;
begin
  -- Mark in-flight attempts on expired/aborted runs as failed
  update scrape_attempts a
  set finished_at = now(),
      outcome = 'failed',
      error_code = 'INTERRUPTED',
      error_message = 'Interrupted by server restart or run expiration'
  from scrape_runs r
  where a.run_id = r.id
    and a.outcome is null
    and (r.lease_until < now() or r.status in ('interrupted', 'aborted'));
  get diagnostics v_attempts_swept = row_count;

  -- Mark expired runs as interrupted
  update scrape_runs
  set status = 'interrupted',
      finished_at = now(),
      note = coalesce(note || '; ', '') || 'Interrupted by startup sweep'
  where status = 'running'
    and lease_until < now();
  get diagnostics v_runs_swept = row_count;

  -- Clear expired product leases
  update tracked_products
  set locked_until = null
  where locked_until < now();
  get diagnostics v_locks_cleared = row_count;

  return jsonb_build_object(
    'attempts_swept', v_attempts_swept,
    'runs_swept', v_runs_swept,
    'locks_cleared', v_locks_cleared
  );
end;
$$;

-- 10. prune_debug: null out old debug payloads
create or replace function prune_debug(p_older_than timestamptz)
returns int
language plpgsql
security definer
as $$
declare
  v_pruned int;
begin
  update scrape_attempts
  set debug = null
  where started_at < p_older_than
    and debug is not null;
  get diagnostics v_pruned = row_count;

  return v_pruned;
end;
$$;
