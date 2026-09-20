-- 0001_init.sql
-- Base schema for INE Product Price Tracker

create extension if not exists pg_trgm;
create extension if not exists pgcrypto;

-- Snapshot of the store's real catalog, used for search. Not authoritative for price.
create table if not exists catalog_products (
  store_product_id text primary key,
  name             text not null,
  name_search      text not null,             -- normalized: lowercase, unaccented, zero-width stripped
  category         text,
  image_url        text,
  attributes       jsonb not null default '{}',   -- only fields the store actually exposes
  first_seen_at    timestamptz not null default now(),
  last_seen_at     timestamptz not null default now(),
  delisted_at      timestamptz
);

create index if not exists catalog_products_trgm on catalog_products using gin (name_search gin_trgm_ops);

create table if not exists tracked_products (
  id                     uuid primary key default gen_random_uuid(),
  store_product_id       text not null unique,      -- no FK: tracking must survive catalog changes
  name                   text not null,
  category               text,
  image_url              text,
  attributes             jsonb not null default '{}',
  is_active              boolean not null default true,
  added_at               timestamptz not null default now(),
  deactivated_at         timestamptz,
  locked_until           timestamptz,               -- lease: prevents concurrent scrapes of one product
  last_attempt_at        timestamptz,
  last_success_at        timestamptz,
  consecutive_failed_jobs int not null default 0,
  status_note            text                       -- e.g. NOT_FOUND_CONFIRMED; only from real evidence
);

create table if not exists scrape_runs (
  id              uuid primary key default gen_random_uuid(),
  trigger         text not null check (trigger in ('cron','manual','initial')),
  scheduled_slot  timestamptz,                      -- set for cron runs; UNIQUE => idempotent ticks
  started_at      timestamptz not null default now(),
  finished_at     timestamptz,
  lease_until     timestamptz not null,
  status          text not null check (status in
                   ('running','completed','completed_with_failures','aborted','interrupted')),
  products_total  int not null default 0,
  products_ok     int not null default 0,
  products_failed int not null default 0,
  note            text
);

create unique index if not exists scrape_runs_slot_uq on scrape_runs (scheduled_slot) where scheduled_slot is not null;

-- The per-product scrape log. One row per ATTEMPT.
create table if not exists scrape_attempts (
  id                 uuid primary key default gen_random_uuid(),
  run_id             uuid not null references scrape_runs(id),
  tracked_product_id uuid not null references tracked_products(id),
  attempt_number     int  not null check (attempt_number >= 1),
  started_at         timestamptz not null,
  finished_at        timestamptz,
  duration_ms        int,
  outcome            text check (outcome in ('success','retried','failed')),  -- NULL while in flight
  error_code         text,
  error_message      text,                          -- truncated (<=500 chars)
  http_status        int,
  strategy           text not null,                 -- 'browser' | 'http'
  scraper_version    text not null,
  debug              jsonb,                         -- failures only, size-capped (<=8 KB)
  unique (run_id, tracked_product_id, attempt_number)
);

create index if not exists scrape_attempts_prod_time on scrape_attempts (tracked_product_id, started_at desc);

-- Only ever written for a SUCCESSFUL, fully validated attempt.
create table if not exists price_observations (
  id                 uuid primary key default gen_random_uuid(),
  tracked_product_id uuid not null references tracked_products(id),
  attempt_id         uuid not null unique references scrape_attempts(id),
  observed_at        timestamptz not null,          -- when data was captured, not when inserted
  price_minor        bigint not null check (price_minor > 0),   -- integer minor units (paise/cents); never float
  currency           text   not null check (char_length(currency) = 3),
  stock_state        text   not null check (stock_state in ('in_stock', 'low_stock', 'out_of_stock')),
  stock_quantity     int    check (stock_quantity is null or stock_quantity >= 0),
  list_price_minor   bigint check (list_price_minor is null or list_price_minor > 0),  -- only if reliably extracted
  raw_price_text     text not null,
  raw_stock_text     text not null,
  price_source       text not null,                 -- which signal produced it, e.g. 'authoritative_quote' | 'dom_visible'
  cross_checked      boolean not null               -- true if >=2 independent signals agreed
);

create index if not exists price_obs_prod_time on price_observations (tracked_product_id, observed_at desc);

-- RLS: backend only accesses via service role key
alter table catalog_products   enable row level security;
alter table tracked_products   enable row level security;
alter table scrape_runs        enable row level security;
alter table scrape_attempts    enable row level security;
alter table price_observations enable row level security;
