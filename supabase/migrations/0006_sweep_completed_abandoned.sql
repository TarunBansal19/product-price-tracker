-- 0006_sweep_completed_abandoned.sql
-- Fix sweep_stale() to also sweep any attempt with outcome is null on finished runs

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
  -- 1. Mark in-flight attempts on expired or already finished runs as failed
  update scrape_attempts a
  set finished_at = coalesce(a.finished_at, now()),
      outcome = 'failed',
      error_code = coalesce(a.error_code, 'INTERRUPTED'),
      error_message = coalesce(a.error_message, 'Interrupted before outcome could be recorded')
  from scrape_runs r
  where a.run_id = r.id
    and a.outcome is null
    and (r.lease_until < now() or r.finished_at is not null or r.status in ('interrupted', 'aborted', 'completed', 'completed_with_failures'));
  get diagnostics v_attempts_swept = row_count;

  -- 2. Mark expired runs as interrupted
  update scrape_runs
  set status = 'interrupted',
      finished_at = now(),
      note = coalesce(note || '; ', '') || 'Interrupted by startup sweep'
  where status = 'running'
    and lease_until < now();
  get diagnostics v_runs_swept = row_count;

  -- 3. Any dangling 'retried' attempt on an interrupted/aborted run must be marked 'failed'
  -- to guarantee Invariant I6 when a job crashes or terminates between retries
  update scrape_attempts a
  set outcome = 'failed',
      finished_at = coalesce(a.finished_at, now()),
      error_code = coalesce(a.error_code, 'INTERRUPTED'),
      error_message = coalesce(a.error_message || ' (run interrupted before retry)', 'Run interrupted before retry')
  from scrape_runs r
  where a.run_id = r.id
    and a.outcome = 'retried'
    and r.status in ('interrupted', 'aborted', 'completed', 'completed_with_failures')
    and a.attempt_number = (
      select max(a2.attempt_number)
      from scrape_attempts a2
      where a2.run_id = a.run_id and a2.tracked_product_id = a.tracked_product_id
    );

  -- 4. Clear expired product leases
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
