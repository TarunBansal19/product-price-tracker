-- 0005_fix_finish_attempt_success.sql
-- Support both camelCase and snake_case keys in p_observation jsonb payload

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
    coalesce(p_observation->>'observed_at', p_observation->>'observedAt')::timestamptz,
    coalesce(p_observation->>'price_minor', p_observation->>'priceMinor')::bigint,
    coalesce(p_observation->>'currency', 'INR'),
    coalesce(p_observation->>'stock_state', p_observation->>'stockState'),
    coalesce(p_observation->>'stock_quantity', p_observation->>'stockQuantity')::int,
    coalesce(p_observation->>'list_price_minor', p_observation->>'listPriceMinor')::bigint,
    coalesce(p_observation->>'raw_price_text', p_observation->>'rawPriceText'),
    coalesce(p_observation->>'raw_stock_text', p_observation->>'rawStockText'),
    coalesce(p_observation->>'price_source', p_observation->>'priceSource'),
    coalesce(p_observation->>'cross_checked', p_observation->>'crossChecked')::boolean
  )
  returning id into v_obs_id;

  -- 3. Update tracked product stats
  update tracked_products
  set last_attempt_at = now(),
      last_success_at = now(),
      consecutive_failed_jobs = 0,
      locked_until = null
  where id = v_product_id;

  return v_obs_id;
end;
$$;
