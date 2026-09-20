# plan.md — INE Product Price Tracker (Web Scraping Assignment)

> Audience: a terminal coding agent working with the repo owner.
> Scope now: **base features only**. No bonus items. Frontend is deliberately minimal.
> The heart of this project is a **scraper that stays correct across many unattended runs**.

---

## 0. Operating rules for the agent (non-negotiable)

Read this whole file before writing any code. Work phase by phase. Do not start a phase until the previous phase's **exit criteria** are met. Commit at the end of every phase.

| # | Rule |
|---|------|
| R1 | **No fabricated data. Ever.** No seed rows, no placeholder products, no hard-coded prices, no mock API in any app code path, no back-filled history. UI empty states must be honest ("No observations yet"). |
| R2 | **Test fixtures are real captures** taken from the live store by a script (`cli/capture-fixtures.js`), stored with capture timestamp + URL. Never hand-write a fake store response and call it a fixture. (Fault-simulation tests may inject failures at the network boundary to test *our* retry code; they never produce data that reaches the DB or UI.) |
| R3 | **Never store a price/stock unless it passed every validation gate (§8.4).** A failed attempt writes an attempt-log row and **no** observation row. |
| R4 | **Scrape only `https://demo.inelabteamdev.com`.** URLs are built in exactly one function; every request/navigation passes an origin allow-list check. Clients send product IDs, never URLs. |
| R5 | **Do not guess how the store behaves — measure it (Phase 0).** Record findings in `docs/store-analysis.md`. If reality contradicts this plan, reality wins; note the deviation in `docs/DESIGN.md`. |
| R6 | **Keep it explainable.** The owner may be asked to modify the code live in a video interview. Plain JavaScript (ESM), few dependencies, small files, comments explaining *why*, no clever abstractions. |
| R7 | No secrets in git. `.env` is git-ignored; ship `.env.example`. The repo is public. |
| R8 | Maintain `docs/ai-mistakes.md`: every time an AI-generated first attempt is wrong, log it **with evidence** (failing output, commit hash, what the fix was). **Never invent entries** — the design note must be truthful. |
| R9 | When a requirement is ambiguous, choose the interpretation that favours **data honesty and reliability**, and write the reasoning into `docs/DESIGN.md`. |
| R10 | Prefer lightweight HTTP where it is *genuinely reliable*; use a headless browser only where Phase 0 evidence shows it is required. Record the evidence. |

---

## 1. Context, deadline, critical path

* Submission deadline: **Sunday 20 Sep 2026, 11:59 PM IST**. Time is short.
* "Many unattended runs" needs *elapsed wall-clock time*: one run per 2 h → ~12 runs/day. **Get the scraper + cron deployed early (end of Phase 4)** and let it accumulate real history while the frontend/docs are finished. Never back-fill or fake history.
* Required deliverables: live site (Vercel), public GitHub repo, 2–4 min headed-run screen recording, README (setup, schedule, env vars), design note (reliability, trade-offs, what AI got wrong + fixes), PDF resume.

### Required product behaviour (from the assignment)
1. Search the mock store by partial/full product name; pick a product; persist tracked products in Supabase.
2. Scrape each tracked product's **current price and stock every 2 hours**, triggered by an **external cron / scheduled function** (free-tier backends sleep).
3. Show price + stock history (table now, chart later) and a **per-product scrape log** with timestamp and outcome (`success` / `retried` / `failed`). Failures are recorded honestly.
4. A **headed (observable) run** mode for the scraper, showing handling of a slow/failing response.

---

## 2. Preliminary intel on the store — **UNVERIFIED, verify in Phase 0**

Directly confirmed: a plain GET of `/` returns an almost empty HTML shell (title "INE Store"). The site is client-rendered, so **parsing the initial HTML will not yield products**.

Secondhand hints from public descriptions of this store. Treat every line as a *hypothesis to confirm or refute*, not as fact:

* Catalog may be reachable through a public JSON endpoint with pagination (e.g. something like `/api/catalog?page=N&pageSize=…`).
* The price may be **gated**: revealed only after interaction telemetry (mouse moves/dwell), a client-side proof-of-work (possibly WebAssembly), a short-lived scoped token, and/or an encoded/encrypted payload. Price loads may come from a separate price endpoint.
* The DOM may contain **decoy prices** (hidden spans, struck-through "MRP", promo badges, related-product prices).
* **CSS class names may rotate**; price **formats vary** (`Rs. 12,723.00`, `₹…`, etc.); digits may contain **zero-width characters**; several **stock phrasings** exist.
* **Injected chaos**: slow responses, dropped/erroring requests, delayed clicks, content that appears after a delay.

If true, a plain `fetch` + cheerio approach will not work for price and a browser (or a faithful protocol client) is needed. **Phase 0 decides.** Do not copy anyone's design; derive it from your own measurements.

---

## 3. Default stack decisions (Phase 0 may amend #4 and #5)

| # | Decision | Reason |
|---|----------|--------|
| 1 | Backend: **Node ≥20, Express, plain JS (ESM)**, `zod` for validation, `pino` logging | Matches spec; no TS build step on Render; simple to explain |
| 2 | DB: **Supabase Postgres via `@supabase/supabase-js` (HTTPS) + SQL RPC functions** for atomic operations | Avoids Supabase's IPv6-only direct connection problem on free hosts; RPCs give real transactions |
| 3 | Frontend: **React + Vite**, single page, plain CSS, tables only | Minimal for now |
| 4 | Catalog/search: lightweight HTTP **if** a catalog endpoint exists | Cheap, fast, no browser |
| 5 | Price/stock: **decided by Phase 0 evidence** (§6.4) — expected: browser for gated price, HTTP for catalog (hybrid) | Judgment criterion of the assignment |
| 6 | Scheduling: **cron-job.org** → `POST /api/cron/tick` every 2 h, plus a keep-warm `GET /api/health` job | Spec-sanctioned; free-tier sleep |
| 7 | Tests: Node's built-in test runner (`node --test`) | Zero deps |
| 8 | Backend hosting: Render **Docker** web service if Playwright is used (needs OS libs); Frontend: Vercel; DB: Supabase | Spec |

---

## 4. Architecture

```
cron-job.org ──(POST /api/cron/tick, every 2h, Bearer secret)──┐
cron-job.org ──(GET /api/health, every ~10 min: keep warm)─────┤
                                                               ▼
 React (Vercel) ── REST ──►  Express API (Render)  ──► Supabase Postgres
                              │      ▲                 (tables + RPC fns)
                              │      │
                              ▼      │
                     Run orchestrator (async, after 202)
                       └─ per product: job runner (retry loop)
                            └─ scraper strategy (browser and/or http)
                                 └─ validation gates → observation
                              store client ──► demo.inelabteamdev.com ONLY
```

Key idea: **the tick endpoint returns 202 immediately** (cron-job.org's response timeout is short — verify, believed ~30 s) and the run continues in the background on a warm instance. State lives in Postgres, never in memory, so restarts are recoverable.

---

## 5. Repository layout

```
/
├─ backend/
│  ├─ src/
│  │  ├─ config.js               # env parsing (zod), defaults, fail-fast
│  │  ├─ server.js               # app bootstrap, graceful shutdown, startup sweep
│  │  ├─ routes/                 # health.js catalog.js tracked.js cron.js
│  │  ├─ middleware/             # auth.js (cron secret), errors.js, rateLimit.js, validate.js
│  │  ├─ db/                     # client.js, repo.js (supabase-js + rpc wrappers)
│  │  ├─ store/
│  │  │  ├─ urls.js              # buildStoreUrl(), assertStoreOrigin() — ONLY place URLs are made
│  │  │  ├─ catalogClient.js     # lightweight HTTP catalog fetch (if endpoint exists)
│  │  │  ├─ priceScraper.js      # scrape strategy (browser and/or http) → RawObservation
│  │  │  ├─ browserPool.js       # launch/reuse/recover Chromium (if used)
│  │  │  ├─ extract/             # PURE fns: normalizeText, parsePrice, parseStock, pickPrice
│  │  │  ├─ validate.js          # PURE validation gates
│  │  │  └─ errors.js            # ScrapeError {code, retryable, details}
│  │  ├─ runner/
│  │  │  ├─ runScrape.js         # one cron/manual run over all active products
│  │  │  ├─ jobRunner.js         # per-product retry loop
│  │  │  ├─ retry.js             # backoff+jitter, withTimeout, abortable sleep
│  │  │  └─ circuitBreaker.js
│  │  └─ cli/
│  │     ├─ recon.js             # Phase 0 exploration (HAR, screenshots, DOM dumps)
│  │     ├─ capture-fixtures.js  # save REAL responses/DOM into test/fixtures/real
│  │     ├─ scrape.js            # run scraper for given ids, headed or headless
│  │     ├─ probe.js             # reliability soak against the live store
│  │     ├─ sync-catalog.js
│  │     └─ verify-invariants.js # checks DB invariants (§7.3)
│  ├─ test/{unit,fault,fixtures/real}/
│  ├─ Dockerfile
│  ├─ package.json
│  └─ .env.example
├─ frontend/                     # Vite + React (minimal)
├─ supabase/migrations/          # 0001_init.sql, 0002_rpc.sql
├─ docs/
│  ├─ store-analysis.md          # Phase 0 findings (evidence-based)
│  ├─ DESIGN.md                  # design note (deliverable)
│  ├─ ai-mistakes.md             # honest log (feeds DESIGN.md)
│  └─ verification.md            # manual cross-checks + soak results
├─ README.md
└─ plan.md
```

---

## 6. Phase 0 — Reconnaissance (time-box: ≤ 2 h) — **do not skip**

Goal: replace §2's hypotheses with evidence and choose the scraping strategy.

### 6.1 Build `cli/recon.js`
Playwright script (headed by default) that, for a given product, records: full network log (HAR), every XHR/fetch request+response (method, URL, headers, status, timing, body sample), console errors, screenshots at t=0/1/3/10 s, DOM snapshot at each point, and `page.evaluate` dumps of candidate price/stock elements including **computed styles** (display, visibility, opacity, text-decoration, font-size, position). Output to git-ignored `recon-output/`.

### 6.2 Questions to answer (write answers in `docs/store-analysis.md`, each with evidence)

| # | Question |
|---|----------|
| Q1 | How is the **catalog** exposed (JSON API? listing pages?), pagination scheme, total count, product ID type/format? Is search server-side or client-side? |
| Q2 | Product page URL pattern; is any content server-rendered? |
| Q3 | Where does the **price** come from — DOM only, or a separate request? What does that request need (headers, tokens, interaction, PoW, attestation, cookies)? Token lifetime? |
| Q4 | Exactly what distinguishes the **real** price from decoys (hidden, struck-through, MRP, promo, related items)? Which signals are *stable* across reloads? |
| Q5 | **Stock**: where shown, complete vocabulary of phrasings (collect ≥30 samples across products), quantity shown? Any disabled-button signal? |
| Q6 | **Price change cadence**: sample one product every ~5 s for ≥5 min. How often does it change, by how much? (Determines whether re-read equality checks are valid.) |
| Q7 | **Latency & failure profile**: ≥30 loads of the price path → distribution (p50/p95/p99), failure rate, failure *kinds* (slow, 5xx, hang/never-settles, dropped click, malformed body). |
| Q8 | What loads **asynchronously after a delay**, and what placeholder is shown meanwhile ("Loading…", "—", "0", skeleton)? |
| Q9 | Does **headless vs headed** behave differently? (Gate may detect headless.) |
| Q10 | Any rate-limit signals (429, `Retry-After`)? Any cookie/consent overlays? |
| Q11 | What **extra product info** is available for the dashboard (category, brand, rating, description, image, list price)? |
| Q12 | Does the DOM structure/class naming change between reloads? Which attributes/roles/text anchors are stable? |

### 6.3 Capture real fixtures
Run `capture-fixtures.js` for ≥8 varied products (different categories, in/out of stock, different price formats), ≥2 captures each at different times. Save raw response bodies / DOM HTML with `{capturedAt, url, productId, notes}`. These drive all parser tests. Also capture at least one real **slow** and one real **failed** response when they naturally occur.

### 6.4 Strategy decision gate (record in `docs/store-analysis.md` + `docs/DESIGN.md`)

```
Is price obtainable via plain HTTP (no interaction/attestation/encoded payload)?
 ├─ YES → HTTP client for price. Prove reliability ≥ browser over ≥30 trials.
 └─ NO  → Can prerequisites (PoW, token, encoded payload) be satisfied in Node
          reliably and *legitimately reproducibly*?
           ├─ YES, and it beats a browser on reliability + memory → protocol client (Branch B)
           └─ NO / fragile / undocumented / breaks between reloads → Playwright (Branch A)
```

* **Branch A (browser):** production scraper uses Playwright; headed mode = same code with `headless:false`. Catalog still via HTTP if available (hybrid).
* **Branch B (protocol client):** the assignment still requires a *headed* run. Keep a first-class browser strategy for the observable run and as a fallback, and be transparent in `DESIGN.md` about which strategy production uses. Do not present a browser demo as if it were the production path.
* Choose based on measured numbers (success rate, time per scrape, RAM). Render free instance is small (believed 512 MB RAM / 0.1 CPU — verify current terms): design for **concurrency = 1**.

### 6.5 Phase 0 exit criteria
- [ ] `docs/store-analysis.md` answers Q1–Q12 with evidence.
- [ ] Real fixtures committed under `backend/test/fixtures/real/` with metadata.
- [ ] Strategy decision + numbers recorded.
- [ ] Timeouts/retry constants chosen from measured p99, not guessed.
- [ ] Stock vocabulary and price-format list are the **observed** ones.

---

## 7. Data model (Supabase Postgres)

### 7.1 Tables (`supabase/migrations/0001_init.sql`)

```sql
create extension if not exists pg_trgm;
create extension if not exists pgcrypto;

-- Snapshot of the store's real catalog, used for search. Not authoritative for price.
create table catalog_products (
  store_product_id text primary key,          -- confirm type in Phase 0
  name             text not null,
  name_search      text not null,             -- normalized: lowercase, unaccented, zero-width stripped
  category         text,
  image_url        text,
  attributes       jsonb not null default '{}',   -- only fields the store actually exposes
  first_seen_at    timestamptz not null default now(),
  last_seen_at     timestamptz not null default now(),
  delisted_at      timestamptz
);
create index catalog_products_trgm on catalog_products using gin (name_search gin_trgm_ops);

create table tracked_products (
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

create table scrape_runs (
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
create unique index scrape_runs_slot_uq on scrape_runs (scheduled_slot) where scheduled_slot is not null;

-- The per-product scrape log. One row per ATTEMPT.
create table scrape_attempts (
  id                 uuid primary key default gen_random_uuid(),
  run_id             uuid not null references scrape_runs(id),
  tracked_product_id uuid not null references tracked_products(id),
  attempt_number     int  not null check (attempt_number >= 1),
  started_at         timestamptz not null,
  finished_at        timestamptz,
  duration_ms        int,
  outcome            text check (outcome in ('success','retried','failed')),  -- NULL while in flight
  error_code         text,
  error_message      text,                          -- truncated (≤500 chars)
  http_status        int,
  strategy           text not null,                 -- 'browser' | 'http'
  scraper_version    text not null,
  debug              jsonb,                         -- failures only, size-capped (≤8 KB)
  unique (run_id, tracked_product_id, attempt_number)
);
create index scrape_attempts_prod_time on scrape_attempts (tracked_product_id, started_at desc);

-- Only ever written for a SUCCESSFUL, fully validated attempt.
create table price_observations (
  id                 uuid primary key default gen_random_uuid(),
  tracked_product_id uuid not null references tracked_products(id),
  attempt_id         uuid not null unique references scrape_attempts(id),
  observed_at        timestamptz not null,          -- when data was captured, not when inserted
  price_minor        bigint not null check (price_minor > 0),   -- integer minor units (paise/cents); never float
  currency           text   not null check (char_length(currency) = 3),
  stock_state        text   not null,               -- CHECK list defined after Phase 0 from OBSERVED states only
  stock_quantity     int    check (stock_quantity is null or stock_quantity >= 0),
  list_price_minor   bigint check (list_price_minor is null or list_price_minor > 0),  -- only if reliably extracted
  raw_price_text     text not null,
  raw_stock_text     text not null,
  price_source       text not null,                 -- which signal produced it, e.g. 'price_response' | 'dom_visible'
  cross_checked      boolean not null               -- true if ≥2 independent signals agreed
);
create index price_obs_prod_time on price_observations (tracked_product_id, observed_at desc);

alter table catalog_products   enable row level security;
alter table tracked_products   enable row level security;
alter table scrape_runs        enable row level security;
alter table scrape_attempts    enable row level security;
alter table price_observations enable row level security;
-- No policies: only the backend's service-role key may access. The browser never talks to Supabase.
```

### 7.2 RPC functions (`0002_rpc.sql`) — atomic, called from the backend

| Function | Purpose |
|----------|---------|
| `claim_cron_run(p_slot, p_lease_seconds)` | `insert … on conflict (scheduled_slot) do nothing returning id`. `NULL` ⇒ slot already handled. |
| `claim_manual_run(p_trigger, p_lease_seconds)` | Create a non-slot run. |
| `claim_product(p_product_id, p_lease_seconds)` | `update … set locked_until=now()+lease where id=… and (locked_until is null or locked_until<now()) returning true`. Prevents cron+manual collision. |
| `release_product(p_product_id)` | Clears the lease. |
| `begin_attempt(p_run, p_product, p_attempt_no, p_strategy, p_version)` | Inserts in-flight attempt row; returns id. |
| `finish_attempt_failed(p_attempt, p_outcome, p_code, p_message, p_http_status, p_debug)` | `p_outcome` = `retried` or `failed`. Updates product counters. |
| `finish_attempt_success(p_attempt, p_observation jsonb)` | **One transaction:** insert observation + set attempt `success` + update product `last_success_at`, reset `consecutive_failed_jobs`. |
| `finish_run(p_run, p_status, p_counts…, p_note)` | Close the run. |
| `sweep_stale()` | Mark in-flight attempts / running runs past their lease as `failed`/`interrupted` with `INTERRUPTED`; clear expired product leases. |
| `prune_debug(p_older_than)` | Null out `debug` payloads on old attempts (keeps rows). |

### 7.3 Data invariants (verified by `cli/verify-invariants.js`; run before submission)
- I1: every `price_observations` row links to exactly one attempt with `outcome='success'`.
- I2: no attempt with `outcome in ('retried','failed')` has an observation.
- I3: `price_minor > 0`, currency present, stock state ∈ observed vocabulary.
- I4: no attempt stays in flight (`outcome is null`) beyond its run's lease.
- I5: observations are append-only; never updated or back-filled.
- I6: within a job, `retried` attempts are followed by a later attempt (a `retried` row is never last).
- I7: `observed_at ≤ inserted time` and not in the future.

---

## 8. Scraper design (the core)

### 8.1 Pipeline per attempt
```
buildStoreUrl(id) → acquire page/request (with hard timeout + abort)
  → satisfy store's gating (per Phase 0) → wait for READY signals (no fixed sleeps)
  → extract candidates (price, stock, product identity) from independent signals
  → normalize → validate (gates §8.4) → RawObservation | ScrapeError(code, retryable)
```
Every step is bounded by a timeout. Every failure is a typed `ScrapeError`.

### 8.2 Price extraction rules
* **Never select by class name** (may rotate). Use stable anchors found in Phase 0: response payloads, roles/aria/data attributes, text patterns, structure relative to the product title.
* Scope to the **main product container**, not the whole page (avoid related-item prices).
* Accept a DOM candidate only if **visible** by computed style (not `display:none`, `visibility:hidden`, `opacity:0`, off-screen, zero size) and **not struck-through** (`text-decoration: line-through`) and not labelled as MRP/was/EMI/shipping/tax.
* Prefer an **authoritative source** (the actual price response tied to the product + token) and **cross-check** it with the visible DOM value. Record `cross_checked`.
* If candidates disagree or several plausible prices remain → `PRICE_AMBIGUOUS` (fail), never pick "the first one".
* Normalize text before parsing: NFKC; strip zero-width/format characters (`\u200B-\u200F \u202A-\u202E \u2060 \uFEFF \u00AD`); NBSP → space; collapse whitespace. Then parse with a **strict** grammar built from *observed* formats (currency prefix/suffix, Indian or Western digit grouping, 0–2 decimals). Unknown format → `PRICE_UNPARSEABLE` with raw text in `debug`; do not guess.
* Convert to **integer minor units** with string math (no floats). Reject NaN, ≤0, absurdly large (configurable ceiling), >2 decimals.

### 8.3 Stock extraction rules
* Map only **observed phrasings** to a fixed vocabulary (e.g. `in_stock`, `low_stock`, `out_of_stock`, … — final list from Phase 0). Extract quantity when present ("Only N left").
* **A missing element is not "out of stock"** → `STOCK_MISSING` (fail). An unrecognized phrase → `STOCK_UNRECOGNIZED` (fail, raw text kept in `debug` so the mapping can be extended later).
* If two signals conflict (text vs. disabled button) → `STOCK_CONFLICT` (fail) unless Phase 0 established a precedence rule with evidence.
* Strict policy (default): an observation requires **both** a valid price **and** a recognized stock state. Partial data is a failed attempt, not a half-empty row. (Trade-off noted in DESIGN.md.)

### 8.4 Validation gates (all must pass → else typed error; pure functions in `validate.js`)
| Gate | Check | Error |
|------|-------|-------|
| V1 | Response/page is the expected kind (status OK, expected content shape; schema-validated with zod; not a soft-error page with HTTP 200) | `UNEXPECTED_CONTENT` / `HTTP_*` |
| V2 | **Content ready**: no placeholder tokens (`Loading`, `—`, `0`, skeleton); value present | `CONTENT_NOT_READY` |
| V3 | **Product identity**: id (and name) in the payload/page equals the requested product | `PRODUCT_MISMATCH` |
| V4 | **Price sane**: parsed, >0, ≤ ceiling, currency recognized | `PRICE_UNPARSEABLE` / `PRICE_IMPLAUSIBLE` |
| V5 | **Price unambiguous**: single surviving candidate, or all agree | `PRICE_AMBIGUOUS` |
| V6 | **Stability** (only if Phase 0 shows price is stable within the window): two reads `STABILITY_MS` apart agree. If the price changes faster than the window, rely on authoritative-source + identity + schema instead — decide from Q6 | `PRICE_UNSTABLE` |
| V7 | **Outlier confirmation**: if new price deviates > `OUTLIER_PCT` from last accepted price (or currency changed), require a second independent read (fresh context/token) agreeing within tolerance before storing. Prices change frequently, so a real large change is *allowed* if confirmed | `PRICE_IMPLAUSIBLE` |
| V8 | **Stock recognized** (§8.3) | `STOCK_*` |
| V9 | **Freshness**: if payload carries an expiry/quote timestamp, it must not be expired | `TOKEN_EXPIRED` |

### 8.5 Timeouts, retries, backoff (defaults; tune from Phase 0 measurements; all env-overridable)
| Setting | Default | Notes |
|---------|---------|-------|
| `ATTEMPT_TIMEOUT_MS` | 30000 (set ≥ measured p99 + margin) | **Hard** timeout enforced by `withTimeout` + `AbortController`; also force-closes the page/context, because some calls (and the store) can hang without ever settling |
| `MAX_ATTEMPTS` | 4 | inline attempts per product per run |
| Backoff | 1.5 s × 2ⁿ, cap 15 s, ±30 % jitter | honour `Retry-After` |
| `JOB_DEADLINE_MS` | 120000 | per product per run |
| `RUN_DEADLINE_MS` | 1500000 (25 min) | remaining products logged as `SKIPPED_RUN_DEADLINE` |
| `CONCURRENCY` | 1 | memory + politeness |
| Inter-product delay | 500–1500 ms random | politeness |
| Deferred retry (P1) | one extra attempt for products that exhausted retries, executed **after** the rest of the run | store slowness is often temporal |

Node's built-in `fetch` has very long default timeouts — **always** pass `AbortSignal.timeout(...)`.

### 8.6 Error taxonomy (`store/errors.js`)
| Code | Retryable | Notes |
|------|-----------|-------|
| `ATTEMPT_TIMEOUT`, `NAV_TIMEOUT`, `NETWORK_ERROR` (DNS/TLS/reset) | yes | |
| `HTTP_5XX`, `HTTP_429` | yes | back off; honour `Retry-After` |
| `HTTP_4XX_OTHER` | case-by-case | 403 may be a gate failure → `GATE_NOT_PASSED` |
| `GATE_NOT_PASSED`, `TOKEN_EXPIRED`, `CLICK_NOT_REGISTERED` | yes | fresh context/token each retry |
| `CONTENT_NOT_READY`, `PRICE_UNSTABLE` | yes | |
| `UNEXPECTED_CONTENT` | yes, then `STRUCTURE_CHANGED` if persistent across attempts | |
| `PRODUCT_MISMATCH` | yes | stale SPA DOM / wrong response |
| `PRICE_UNPARSEABLE`, `PRICE_AMBIGUOUS`, `PRICE_IMPLAUSIBLE`, `STOCK_MISSING`, `STOCK_UNRECOGNIZED`, `STOCK_CONFLICT` | retry once or twice, then fail | may be transient render state; if consistent → real parser gap, keep debug |
| `NOT_FOUND` | confirm with 1 retry, then fail | a single 404 may be injected; 2 consecutive ⇒ `status_note=NOT_FOUND_CONFIRMED`, keep tracking |
| `STRUCTURE_CHANGED` | no (fail with debug snapshot) | required anchors absent though page loaded fine |
| `BROWSER_CRASHED` | yes | relaunch browser |
| `INTERRUPTED`, `SKIPPED_CIRCUIT_OPEN`, `SKIPPED_RUN_DEADLINE`, `PERSIST_FAILED` | n/a | final; logged honestly |

### 8.7 Attempt outcome semantics (what the log shows)
* Attempt failed with a retryable error **and another attempt follows** → `retried`.
* Attempt failed and no further attempt will happen (non-retryable or budget exhausted) → `failed`.
* Attempt passed all gates → `success` (its `attempt_number` shows how many tries it took).
Every attempt is a row; nothing is hidden or collapsed.

### 8.8 Circuit breaker (protects the store and the free-tier budget)
Open after `N=5` consecutive product-level failures whose codes are infrastructure-like (timeouts/5xx/network). When open: wait 45 s, probe once with the next product; if it fails again, abort the run: remaining products get an attempt row `failed` / `SKIPPED_CIRCUIT_OPEN` (honest: they were not scraped), run status `aborted`. Data-quality errors (parse/stock) do **not** trip the breaker.

### 8.9 Browser lifecycle (if Branch A)
* One Chromium per process, launched lazily; relaunch on `disconnected`; recycle after N attempts to bound memory.
* **New BrowserContext per attempt** (no shared cookies/tokens), closed in `finally` with its own timeout.
* Flags for Docker: `--no-sandbox --disable-dev-shm-usage --disable-gpu`.
* Route interception: **abort any request to a non-store origin**; optionally block images/fonts/media to save RAM — **only if** the Phase 0 test proves it doesn't break the gate.
* Wait on **conditions** (`waitForResponse` for the price request, `waitForFunction` for hydrated content), never bare sleeps.
* Interactions: perform what the store's gate needs (per Phase 0). Re-resolve the target element right before acting (layout may shift). After each interaction, **verify the effect** (expected UI/network change) instead of assuming the click landed; retry the interaction a bounded number of times, then fail `CLICK_NOT_REGISTERED`.
* Capture the price response and the visible DOM from the **same page load** so cross-checks compare like with like.

### 8.10 Debug snapshot (failures only, ≤ 8 KB, stored in `scrape_attempts.debug`)
`{ url, strategy, stage, candidates:[{source, rawText, visible, struckThrough}], httpStatus, timings, htmlOrJsonExcerpt(truncated), scraperVersion }`. Strip anything secret. Pruned after 14 days by `prune_debug`.

### 8.11 Headed / observable run
`npm run scrape:headed -- --ids 12,45 [--slowmo 250] [--persist]`
* Same code path as production (`headless:false`), plus a readable **narrative log** driven by the real event stream: `[t+3.2s] product 12 attempt 1/4 → waiting for price response…`, `… TIMEOUT after 30 s → will retry in 2.1 s`, `… price candidates: [₹12,723.00 visible, ₹14,999 struck-through ✗] → accepted 12723.00 (cross-checked)`.
* **Default is `--no-persist`** (prints, writes nothing). `--persist` writes normally.
* Optional fault injection for the demo: `--inject slow|hang|http500|abort` implemented via `page.route` in the **CLI only**. Rules: never combinable with `--persist`; clearly labelled `[INJECTED FAULT]` in output; not importable from the server. Natural store faults should be shown first; injection is only a labelled supplement if none occur during recording. Be honest about which is which in the video and DESIGN.md.

---

## 9. Orchestration & scheduling logic

### 9.1 Tick handling (`POST /api/cron/tick`)
1. Verify `Authorization: Bearer <CRON_SECRET>` with constant-time compare; else 401 (no details).
2. Compute slot: `slot = floor((now + 15 min) / 2 h) * 2 h` (UTC). Early fires (a few min early) map to the upcoming slot; late fires (up to ~1 h 45) still map to the same slot ⇒ **duplicates/retries from the cron service never double-scrape**.
3. `claim_cron_run(slot)`; if `NULL` → respond `200 {status:"skipped", reason:"slot_already_handled"}`.
4. If an in-process/DB run is still `running` within lease → respond `200 skipped: run_in_progress` and record it in `scrape_runs.note` on the current run (honest evidence of overlap).
5. Respond **202** `{runId, slot}` immediately; start `runScrape(runId)` on the event loop (not awaited by the request).
6. Piggyback (P1): if catalog snapshot older than 24 h, sync it *after* the scrape run; catalog failure never blocks scraping.

### 9.2 `runScrape(runId)`
```
sweep_stale()
products = active tracked products (cap MAX_TRACKED)
for each product (sequential, CONCURRENCY=1):
   if run deadline exceeded → log SKIPPED_RUN_DEADLINE, continue
   if breaker open → follow §8.8
   if !claim_product(id, lease) → log skipped (locked by another job); continue
   try  jobRunner(product)          // retry loop; every attempt persisted via RPC
   catch → log, mark failed, continue    // one poison product never stops the run
   finally release_product(id)
finish_run(status, counts)
```
* Each attempt: `begin_attempt` → work → `finish_attempt_success|failed`. If persisting an attempt fails, retry the write with backoff (3×); if it still fails, emit the full record as structured JSON to stdout (Render logs) and mark the run `note='PERSIST_FAILED'`. Never crash the loop; never pretend the write happened.
* Manual scrape + initial scrape after tracking use the same `jobRunner` and the same locks.

### 9.3 Process lifecycle (`server.js`)
* On boot: validate env (fail fast with a clear message), run `sweep_stale()` (marks orphaned in-flight attempts/runs from a previous crash/redeploy as `failed`/`INTERRUPTED`).
* `SIGTERM`/`SIGINT`: stop accepting requests, abort in-flight attempt via `AbortController`, record `INTERRUPTED`, close browser, exit within Render's grace period.
* `unhandledRejection` / `uncaughtException`: log fatally with context; exit non-zero so the platform restarts; startup sweep repairs state.

### 9.4 Free-tier scheduling (`README` must document exactly)
| cron-job.org job | Request | Schedule (UTC) | Notes |
|------------------|---------|----------------|-------|
| `scrape-tick` | `POST /api/cron/tick`, header `Authorization: Bearer …` | `0 */2 * * *` | Even UTC hours ⇒ **:30 past the hour in IST**. Enable "save response in history" for audit evidence. |
| `keep-warm` | `GET /api/health` | every 10 min | Assignment explicitly allows keeping the instance warm. Keeps the background run alive and avoids cold-start timeouts on the tick. One always-on service fits Render's monthly free hours (verify current terms). |

* If the tick still arrives during a cold start (cron-job.org times out and may mark the call failed): the *next* slot recovers automatically; the missed slot is visible as a gap (`/api/health.missedSlots24h`) — **not** hidden or back-filled.
* `/api/health` must answer fast (2 s DB timeout; degraded response if DB is slow) and report `lastRun`, `lastSuccessfulObservationAt`, and `stale: true` if no successful run in > 3 h. (Dead-man's-switch: the system tells the truth when it has silently stopped.)
* Supabase free projects pause after ~1 week of inactivity; the 2-hourly writes keep it active (verify current terms).

---

## 10. API (Express, JSON, consistent error shape `{error:{code,message}}`)

| Method & path | Auth | Behaviour |
|---------------|------|-----------|
| `GET /api/health` | none | See §9.4. Never leaks secrets/stack traces. |
| `GET /api/catalog/search?q=&limit=&offset=` | none | Searches the **catalog snapshot** (DB). Normalize query (NFKC, lowercase, unaccent, strip zero-width, collapse whitespace, cap 80 chars). Tokenize; AND of `name_search ILIKE '%token%'` with `\ % _` **escaped**; rank exact > prefix > token-position > trigram similarity. Empty query ⇒ first page alphabetical. Return `id, name, category, image, alreadyTracked`. **Do not show catalog prices** as authoritative (may be decoy/stale). If snapshot is empty and store unreachable ⇒ `503 CATALOG_UNAVAILABLE` — never fabricate results. |
| `POST /api/tracked` `{storeProductId}` | none (rate-limited, capped) | Zod-validate id format. Look up in catalog snapshot (or fetch from store if absent). **Idempotent upsert** (unique `store_product_id`); re-tracking a deactivated product reactivates the same row (history preserved). Enforce `MAX_TRACKED`. Kick off an async `initial` scrape (failure doesn't roll back tracking). |
| `GET /api/tracked` | none | Each tracked product + latest observation + last attempt outcome + `lastSuccessAt` + `consecutiveFailedJobs`. |
| `DELETE /api/tracked/:id` | none (rate-limited) | Soft-deactivate (`is_active=false`); history retained. |
| `GET /api/tracked/:id/history?from=&to=&limit=` | none | Observations ascending, default last 500. Uses `observed_at`. |
| `GET /api/tracked/:id/log?limit=&before=&outcome=` | none | Attempts, newest first, **cursor pagination**, includes `attempt_number`, `outcome`, `error_code`, `error_message`, `duration_ms`, `strategy`. |
| `POST /api/tracked/:id/scrape` | none (rate-limited, 60 s cooldown/product) | Manual scrape via same job runner; 409 if product leased. |
| `POST /api/cron/tick` | Bearer `CRON_SECRET` | §9.1 |
| `POST /api/admin/catalog/sync` | Bearer `CRON_SECRET` | Full catalog sync (below). |

**Catalog sync rules:** page through the *entire* catalog with retries; upsert by id; refresh `last_seen_at`; **only** if the crawl completed with no page failures may absent products be marked `delisted_at` (a partial crawl must never mass-delist). Run lazily if the table is empty. A failed sync leaves the old snapshot untouched.

**Hardening:** `helmet`; CORS allow-list = Vercel origin(s) from env; JSON body limit 10 kb; `express-rate-limit` on mutating routes; Zod on every input; parameterized queries only; generic 500s; request IDs in logs.

---

## 11. Frontend (minimal — real engineering is the backend)

React + Vite, one page, plain CSS, **tables only** (chart is a later task). Views: **Search & Track**, **Tracked list**, **Product detail** (history table + scrape log table).

Mandatory honest states:
* API cold start: "Waking up the backend (free tier, up to ~1 min)…" with retry for GETs.
* Loading / error (with the API's error code) / empty ("No observations yet — first scrape pending").
* Show `stale` banner from `/api/health`.
* Timestamps rendered in IST with UTC on hover; prices formatted from `price_minor` + `currency`.
* Log table shows `outcome`, `attempt_number`, `error_code`, `duration_ms` — failures visible, never filtered out by default.
* **No mock/sample data anywhere.** `VITE_API_BASE_URL` is the only config.

---

## 12. Testing & verification (real data first)

| Layer | What | How |
|-------|------|-----|
| Unit (pure) | `normalizeText`, `parsePrice`, `parseStock`, `pickPrice`, validation gates | Run against **real captured fixtures** from Phase 0. Table-driven cases for string edge cases are fine when clearly labelled as inputs to a pure function and derived from *observed* strings; add a case whenever a real failure teaches something. |
| Fault (our logic) | Retry/backoff, `withTimeout` on a never-settling promise, circuit breaker, deadline handling, abort cleanup, lease/slot logic | Inject failures at the transport boundary (dependency-injected). Verifies *our* code; no fake data reaches DB/UI. |
| Live probe | `npm run probe -- --ids … --rounds N` | Real store. Prints per-attempt outcomes and totals: first-attempt success rate, after-retry success rate, retries, failures by code, p50/p95 duration. **Report the raw first-attempt rate honestly** in DESIGN.md. |
| Correctness spot-check | ≥10 scrapes: compare stored price/stock with a screenshot taken in the same headed run | Record in `docs/verification.md` (timestamp, product, stored value, screenshot value). Because prices move, compare within seconds. |
| Crash recovery | `kill -9` server mid-run → restart | `sweep_stale` marks orphans `INTERRUPTED`; no partial observation; next run normal. |
| DB outage | Run with an invalid Supabase key | Writes fail → structured stdout dump, process survives, no fake success. |
| Duplicate tick | Two `curl` ticks for the same slot | Second returns `skipped`. |
| Overlap | Tick while run in progress | `skipped: run_in_progress`, noted. |
| Invariants | `npm run verify:db` | All I1–I7 hold on the real database. |
| Soak | Deployed system, ≥ 24 h of real cron runs | Review gaps, failures, wrong values (target: **zero wrong values stored**; failures allowed but logged). |

---

## 13. Deployment

**Supabase:** create project → run migrations (SQL editor or CLI) → copy URL + **service-role key** (backend only; never in frontend/repo).

**Render (backend, Docker runtime if Playwright is used):**
* Base image `mcr.microsoft.com/playwright:v<EXACT playwright version>-<distro>`; `npm ci --omit=dev`; `CMD ["node","src/server.js"]`. Playwright package version and image tag **must match**. (Native Node runtime can't `apt-get` the Chromium libs during build.)
* Health check path `/api/health`. Auto-deploy from `main`. Set env vars (§14). Optionally `NODE_OPTIONS=--max-old-space-size=256`.
* Free-tier RAM is tight: concurrency 1, one Chromium, recycle periodically, block heavy resources only if proven safe.

**Vercel (frontend):** root dir `frontend`, framework Vite, env `VITE_API_BASE_URL`.

**cron-job.org:** create the two jobs from §9.4; store the secret only in the job header and Render env.

---

## 14. Environment variables (`backend/.env.example`)

| Var | Example / default | Purpose |
|-----|-------------------|---------|
| `NODE_ENV` | `production` | |
| `PORT` | `3001` | Render injects its own |
| `SUPABASE_URL` | `https://xxxx.supabase.co` | |
| `SUPABASE_SERVICE_ROLE_KEY` | *(secret)* | Backend only |
| `CRON_SECRET` | *(long random)* | Protects tick/admin routes |
| `FRONTEND_ORIGINS` | `https://your-app.vercel.app` | CORS allow-list (comma-separated) |
| `STORE_ORIGIN` | `https://demo.inelabteamdev.com` | Fixed allow-listed origin |
| `MAX_TRACKED` | `15` | Bounds run time on free tier |
| `SCRAPE_INTERVAL_HOURS` | `2` | Slot size (spec: fixed 2 h) |
| `ATTEMPT_TIMEOUT_MS`, `MAX_ATTEMPTS`, `BACKOFF_BASE_MS`, `BACKOFF_MAX_MS`, `JOB_DEADLINE_MS`, `RUN_DEADLINE_MS`, `CONCURRENCY` | see §8.5 | |
| `STABILITY_MS`, `OUTLIER_PCT` | from Phase 0 | |
| `HEADED`, `SLOW_MO_MS` | `false`, `0` | CLI/local only; ignored on Render |
| `LOG_LEVEL` | `info` | |

Frontend: `VITE_API_BASE_URL`.

---

## 15. Edge-case matrix (each must be handled or explicitly documented as a limitation)

### 15.1 Store behaviour
| Case | Handling |
|------|----------|
| Client-rendered shell / empty initial HTML | Never parse initial HTML; use hydrated DOM or the data request (Phase 0) |
| Price appears late; placeholder (`Loading`, `—`, `0`, skeleton) | V2 readiness gate; wait on conditions; timeout → `CONTENT_NOT_READY` retry |
| Decoy prices (hidden, struck-through, MRP, promo, EMI, related items) | Scope to product container; visibility/style filters; authoritative-source cross-check; ambiguity → fail |
| Rotating CSS classes | Never rely on classes; stable anchors only |
| Zero-width / bidi / soft-hyphen chars inside digits | Normalize before parsing |
| Multiple price formats & digit grouping | Strict grammar from observed formats; unknown → fail with raw text kept |
| Price changes between reads / large real change | Cadence measured (Q6); outlier needs confirming second read |
| Stock phrasing variants; unknown phrase; missing element; conflicting signals | Observed-vocabulary map; missing ≠ out of stock; conflicts fail |
| Slow response | Timeout ≥ measured p99 + retry with backoff |
| Response that never settles | Hard timeout + abort + forced cleanup |
| 5xx / 429 / connection reset / TLS / DNS | Retryable, backoff, honour `Retry-After` |
| HTTP 200 with error/empty/HTML body; truncated or malformed JSON | Schema validation (V1) → fail |
| Stale/other product's data (SPA transition, redirect, cache) | V3 identity check |
| Gate failures: dropped/delayed clicks, insufficient telemetry, expired token, PoW mismatch | Fresh context/token per attempt; verify interaction effects; bounded retries |
| Layout shift during interaction | Re-resolve element before each action |
| Overlays / consent banners | Detect & dismiss if Phase 0 shows any |
| Product delisted / 404 | Confirm twice → `NOT_FOUND_CONFIRMED`; keep tracking, keep logging honestly |
| Page structure changed | `STRUCTURE_CHANGED` with debug snapshot; no data stored |
| Store totally down | Circuit breaker; `SKIPPED_CIRCUIT_OPEN` rows; run `aborted`; no data |
| Expired quote/token in payload | V9 |
| Store rate-limits us | Lower pace, honour `Retry-After` |

### 15.2 Parsing & data
| Case | Handling |
|------|----------|
| Floating-point error | Integer minor units, string math |
| Zero/negative/NaN/huge price | V4 |
| Currency changes vs last observation | Confirm read (V7) |
| Unchanged price | Still stored (time series of stock/price); UI can show change markers later |
| Same price, stock flips | Stored; stock history is a first-class series |
| `observed_at` semantics | Time of capture (UTC `timestamptz`), not insert time |

### 15.3 Scheduler & runtime
| Case | Handling |
|------|----------|
| Cron fires twice / retries / slightly early or late | Slot rounding + unique slot index ⇒ idempotent |
| Tick during a still-running run | `skipped: run_in_progress`, noted |
| Cold start makes cron call time out | Keep-warm job; 202-immediately; gap visible in health, never hidden |
| Render redeploy/restart mid-run | Boot `sweep_stale`; orphans marked `INTERRUPTED` |
| Manual + cron scrape same product | Product lease (`claim_product`) |
| One product always fails / hangs | Isolated try/catch + per-job deadline; run continues |
| Run exceeds budget | `RUN_DEADLINE_MS`; remaining logged `SKIPPED_RUN_DEADLINE` |
| Browser crash/OOM/zombie processes | `disconnected` handler, relaunch, per-attempt context, periodic recycle |
| `context.close()` hangs | Own timeout; kill browser if needed |
| Unhandled rejection | Fatal log + exit; platform restarts; sweep repairs |
| Ephemeral disk | Nothing critical on disk; DB is the source of truth |

### 15.4 Database
| Case | Handling |
|------|----------|
| Partial writes (attempt says success, observation missing) | `finish_attempt_success` is one transaction |
| Supabase unreachable | Write retry ×3 → stdout JSON dump → `PERSIST_FAILED`; process survives |
| Duplicate track clicks | Unique `store_product_id` + upsert |
| Re-tracking after untrack | Reactivate same row |
| Debug payload growth / 500 MB free cap | Size cap, failures only, `prune_debug` |
| Project paused | Cron writes keep it active; documented |
| Migrations drift | Schema only via `supabase/migrations` |

### 15.5 API / security
| Case | Handling |
|------|----------|
| SSRF via user input | Only IDs accepted; `assertStoreOrigin` on every request + Playwright route guard |
| Abuse: mass tracking / scrape spam | `MAX_TRACKED`, rate limits, per-product cooldown |
| SQL wildcard / injection in search | Escape `% _ \`; parameterized; length cap |
| Unicode/case/accents/partial words in search | Normalization + token AND + prefix |
| Empty / whitespace-only query | Defined behaviour (first page) |
| Bad IDs / unknown resources | 400 / 404 with stable error codes |
| Timing attack on secret | Constant-time compare |
| Secret leakage | `.env` ignored; no secrets in logs; service key backend only; RLS on all tables |
| CORS mismatch | Explicit allow-list from env |

### 15.6 Frontend
| Case | Handling |
|------|----------|
| Backend asleep | Waking message + GET retry |
| Empty / error states | Explicit, honest |
| Long lists | Cursor pagination for log; history limit |
| Timezones | IST display, UTC in tooltip |

---

## 16. Phased task list (check off as you go)

### Phase 0 — Recon (≤2 h) → see §6
- [ ] `cli/recon.js`; answer Q1–Q12; `docs/store-analysis.md`
- [ ] Capture real fixtures; measure latency/failure profile; measure price cadence
- [ ] Strategy decision + evidence; constants chosen from measurements
- [ ] Commit: `docs: store analysis + real fixtures`

### Phase 1 — Scaffold & schema (≤1 h)
- [ ] Repo layout, `.gitignore`, `.env.example`, `config.js` with fail-fast env validation
- [ ] Supabase project; run `0001_init.sql`, `0002_rpc.sql`; finalize `stock_state` CHECK from Phase 0 vocabulary
- [ ] `db/client.js`, `db/repo.js`; smoke test through RPCs
- [ ] `store/urls.js` with origin guard + unit tests

### Phase 2 — Scraper core (≤4 h) ★ the heart
- [ ] `extract/` pure functions + unit tests on real fixtures
- [ ] `validate.js` gates V1–V9 + tests
- [ ] `retry.js` (`withTimeout`, backoff+jitter, abortable sleep) + fault tests (incl. never-settling promise)
- [ ] `priceScraper.js` per chosen branch; typed errors; debug snapshots
- [ ] `jobRunner.js` (retry loop, attempt semantics §8.7), `circuitBreaker.js` + fault tests
- [ ] `cli/scrape.js` (headed/headless, `--no-persist` default) and `cli/probe.js`
- [ ] **Exit:** probe on ≥5 products × ≥10 rounds: zero wrong values stored/printed; every failure typed; first-attempt vs after-retry rates recorded in `docs/verification.md`

### Phase 3 — Persistence, orchestration, API (≤3 h)
- [ ] `runScrape.js` with leases, deadlines, isolation, sweep
- [ ] Routes §10; validation; rate limits; error middleware; graceful shutdown; boot sweep
- [ ] Catalog sync + search (normalization, escaping, ranking)
- [ ] `verify-invariants.js`; run crash/duplicate/overlap/DB-outage tests locally
- [ ] Commit per feature

### Phase 4 — Deploy backend + cron (≤1.5 h) ★ start the unattended clock
- [ ] Dockerfile; Render service; env vars; health check
- [ ] Track 3–5 real products via API; verify a manual scrape end-to-end in production
- [ ] Create both cron-job.org jobs; confirm first real tick produced a run + attempts + observations
- [ ] Record the live URLs; **leave it running**

### Phase 5 — Minimal frontend (≤1.5 h)
- [ ] Search/track, tracked list, detail (history table + log table), honest states, health banner
- [ ] Deploy to Vercel; wire CORS; verify against live backend

### Phase 6 — Hardening, headed run, video (≤2.5 h)
- [ ] Deferred-retry pass (P1), memory/browser recycle check on Render logs
- [ ] Review real production logs: failures by code; fix parser gaps found (add real fixtures + tests)
- [ ] Correctness spot-checks (≥10) in `docs/verification.md`
- [ ] Record headed run video (§17)

### Phase 7 — Docs & submission (≤1.5 h)
- [ ] `README.md` (§18), `docs/DESIGN.md`, finalize `docs/ai-mistakes.md` (real entries only)
- [ ] `npm run verify:db` on production; final check that cron is still producing runs
- [ ] Email (§18) before 11:59 PM IST, Sunday 20 Sep 2026

---

## 17. Screen-recording checklist (2–4 min, headed mode)
1. Show terminal command and the visible browser window; state which products.
2. Run against ≥3 products; narrate the readiness wait and the accepted price with its cross-check.
3. Show a **slow or failing response**: prefer one that occurs naturally (run more products until it does). If none occurs, use the labelled `--inject` flag and *say so on camera*.
4. Show the retry line, backoff, and eventual success (or honest final failure).
5. Show that a failed attempt produced **no observation**, and that the log page lists `retried`/`failed` rows with error codes.
6. Show a `--persist` run reflected in the deployed dashboard's history and log.

---

## 18. Deliverables

**README.md must contain:** overview; live frontend + backend URLs; architecture summary; local setup (backend, frontend, Supabase migrations, `npm run sync:catalog`); **all env vars** (§14); **scraping schedule** (§9.4, exact cron-job.org configuration); headed-run instructions; test/probe commands; deployment steps; known limitations.

**docs/DESIGN.md outline:** 1 Problem & constraints · 2 What the store does (from `store-analysis.md`) · 3 Strategy choice (HTTP vs browser) **with measured evidence** · 4 Reliability mechanisms (timeouts, retries, gates, breaker, leases, idempotent ticks) · 5 Data-integrity invariants · 6 Free-tier scheduling · 7 Trade-offs (strict both-fields policy, concurrency=1, keep-warm cost, catalog snapshot staleness, etc.) · 8 Measured results (real numbers only, including raw first-attempt failure rate) · 9 **What AI tools got wrong on the first attempt and how it was corrected** (copied from `ai-mistakes.md`; real entries only) · 10 Known limitations.

**Submission email:** to `sstephen@ine.com`, cc `ssingh@ine.com`; subject `First Round: Software Engineer Intern Assignment - <Your Name>`; include live link, GitHub URL, video link, PDF resume. Deadline: **20 Sep 2026, 11:59 PM IST**. (Base features only for now; bonus items are out of scope for this plan.)

---

## 19. Definition of done
- [ ] Deployed: Vercel frontend ↔ Render backend ↔ Supabase, reachable from the live link.
- [ ] Cron-job.org ticks every 2 h; multiple real unattended runs visible in history/log (including any real failures).
- [ ] No fabricated data anywhere; `verify:db` passes I1–I7 on production.
- [ ] Every attempt logged with honest outcome; failed attempts create no observations.
- [ ] Headed run works locally and matches production code path; video recorded.
- [ ] README, DESIGN.md (with truthful AI-mistakes section), resume PDF ready; email sent on time.
