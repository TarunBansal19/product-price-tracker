# Design Document: INE Product Price Tracker

## 1. Problem & Constraints

The objective is to continuously track the price and stock of products listed on `https://demo.inelabteamdev.com`, executing automated, unattended scrapes every 2 hours while guaranteeing absolute data integrity over many cycles.

### Key Constraints:
- **Zero Fabricated Data (Rule R1)**: No mock responses, synthetic fixtures, or back-filled histories. If an attempt fails, it must be recorded as a failure or retry; no partial or default observation may be stored.
- **Unattended Execution**: The scraper must run reliably on free-tier hosting (Render free instance with 512 MB RAM / 0.1 CPU, Supabase free Postgres, and Vercel for frontend). Free tier instances sleep when idle and may experience cold starts up to 60 seconds.
- **Strict Single-Store Boundary (Rule R4)**: The system must exclusively interact with `https://demo.inelabteamdev.com`. All network requests pass through origin assertion guards and browser-level route interception to prevent SSRF and external asset leakage.
- **Extreme Store Defenses**: The target store features client-side hydration, delayed content, decoy prices, dynamic overlays, fluctuating formats, and intentional upstream chaos.

---

## 2. Store Behavior Analysis

Empirical reconnaissance (`cli/recon.js` and `docs/store-analysis.md`) revealed the following real architectural characteristics of the target store:

1. **Client-Rendered Shell**: A plain HTTP GET to `/` or `/product/:id` yields an empty SPA HTML shell with `<div id="root"></div>`. Product attributes, title, and initial layout are rendered dynamically via React.
2. **Interactive Price Gating**: Prices are not embedded in the initial product markup. The product page presents a "Reveal Price" button. This button only becomes interactive after client-side telemetry thresholds are satisfied:
   - A minimum of 8 discrete mouse movement events.
   - A minimum cursor dwell time of 600 ms over the price card.
   - Any attempt to bypass telemetry or dispatch synthetic clicks prematurely results in rejected or ignored clicks (`CLICK_NOT_REGISTERED`).
3. **Decoy Prices**: The rendered DOM contains deceptive values:
   - Struck-through list prices / MRPs (`text-decoration: line-through`).
   - Hidden pricing nodes (`display: none`, `opacity: 0`).
   - Related product carousels located further down the page.
4. **Intentional Chaos & Dynamic Modals**:
   - The store periodically spawns a modal overlay (`.cookie-overlay`) that intercepts pointer events. Its dismiss button requires multiple clicks (governed by a chaotic counter) before being detached from the DOM.
   - The upstream price endpoint injects periodic 500 errors and artificial latency spikes.
5. **Stock States**: Stock availability is expressed through distinct natural language phrasings (`In Stock`, `Only 5 left - order soon!`, `Out of Stock`), requiring precise semantic normalization.

---

## 3. Strategy Choice: Hybrid Architecture with Measured Evidence

```
Is price obtainable via plain HTTP without interaction telemetry/PoW?
 └─ NO (Phase 0 showed pricing requires cursor dwell, telemetry, and interactive reveal)
     └─ Can telemetry be reliably reverse-engineered in Node?
         └─ NO: Fragile, brittle to client bundle obfuscation shifts.
             └─ DECISION: Branch A — Playwright Chromium for price/stock; lightweight HTTP for catalog search.
```

### Measured Evidence:
- **Lightweight HTTP**: Consistently fails to yield prices on product pages because the client-rendered bundle never fires the `/price` RPC without the active telemetry harness. However, lightweight HTTP successfully fetches catalog listing pages at `/catalog` with low latency (~300 ms).
- **Headless Playwright**:
  - P50 Duration: 7.6 seconds.
  - P95 Duration: 70.5 seconds (under upstream retry scenarios).
  - First-attempt Success Rate: 80.0%.
  - After-retry Success Rate: 100.0%.
  - Memory Footprint: ~120 MB RSS per Chromium instance when scoped with `--no-sandbox --disable-dev-shm-usage --disable-gpu`.

### Decision:
A **hybrid strategy** was implemented:
- **Catalog Search**: Lightweight HTTP client directly queries catalog pagination endpoints, populating the local database snapshot for instant autocomplete and sub-millisecond search.
- **Price & Stock Scraping**: Playwright Chromium running with single concurrency (`CONCURRENCY = 1`), explicit telemetry emulation, and automatic context recycling.

---

## 4. Reliability Mechanisms

### 4.1 Strict Validation Gates (V1 – V9)
Every raw extraction must pass all 9 validation gates in `store/validate.js` before being accepted:
- **V1 (HTTP & Content)**: Verifies 200 OK status, valid HTML/JSON structure, and absence of error banners.
- **V2 (Readiness)**: Rejects placeholders (`Loading...`, `—`, `0`, or skeletons).
- **V3 (Identity Match)**: Asserts that extracted store ID matches the requested target.
- **V4 (Price Sanity)**: Asserts parsed minor units are integer, positive (`> 0`), and below the sanity ceiling (`₹10,000,000`).
- **V5 (Unambiguity)**: Rejects ambiguous price candidates if multiple conflicting active prices remain.
- **V6 (Stability)**: Verifies price stability over a designated window.
- **V7 (Outlier Confirmation)**: If a price shifts by `> 35%` from the last recorded observation, a fresh context verification read is mandated.
- **V8 (Stock State)**: Enforces mapping strictly to observed vocabulary (`in_stock`, `low_stock`, `out_of_stock`).
- **V9 (Freshness)**: Validates that server response timestamps are not expired.

### 4.2 Timeouts, Retries, and Backoff
- **Hard Per-Attempt Timeout**: Enforced via `AbortController` and `Promise.race([..., timeoutPromise])` to terminate hanging connections.
- **Exponential Backoff with Full Jitter**:
  $$t_{\text{backoff}} = \min(t_{\text{max}}, t_{\text{base}} \times 2^{\text{attempt}}) \pm 30\% \text{ jitter}$$
  Honors upstream `Retry-After` HTTP headers when present.
- **Deferred-Retry Pass (P1)**: Products that fail their initial attempt budget during a run are queued for a final single retry attempt after all other products have been scraped, exploiting the temporal nature of upstream store hiccups.

### 4.3 Circuit Breaker
Protects both the target store and the application budget:
- Automatically trips after 5 consecutive infrastructure failures (timeouts, network drops, HTTP 5xx).
- Data validation errors (e.g. unparseable text) do *not* trip the breaker.
- Once tripped, pauses execution for a 45-second cooldown and probes once before resuming or honestly aborting remaining jobs with `SKIPPED_CIRCUIT_OPEN`.

### 4.4 Concurrency & Memory Safety
- **Concurrency = 1**: Ensures predictable memory consumption (< 384 MB total RSS) to operate safely inside Render's 512 MB free tier.
- **Context Isolation**: A fresh `BrowserContext` is created for every attempt and forcibly closed in a `finally` block with its own timeout.
- **Browser Recycling**: The Chromium browser process is automatically recycled after 50 attempts to eliminate memory leaks.

---

## 5. Data-Integrity Invariants (I1 – I7)

All data stored in Supabase Postgres strictly satisfies the following invariants, continuously verified by `backend/src/cli/verify-invariants.js`:
- **I1**: Every `price_observations` row links to an attempt whose outcome is `success`.
- **I2**: No attempt with outcome `retried` or `failed` has an observation row.
- **I3**: `price_minor > 0`, 3-letter currency code present, and `stock_state` belongs to `['in_stock', 'low_stock', 'out_of_stock']`.
- **I4**: No attempt remains in an in-flight state (`outcome is null`) past its parent run's lease expiration.
- **I5**: Observations are strictly append-only; never modified, overwritten, or backfilled.
- **I6**: Within any job, a `retried` attempt is never left as the final attempt (must be followed by another attempt).
- **I7**: `observed_at` is recorded in UTC and is less than or equal to current wall-clock time.

---

## 6. Free-Tier Scheduling & Idempotency

### Dual-Job Cron Configuration (`cron-job.org`):
1. **`scrape-tick`**: `POST /api/cron/tick` every 2 hours (`0 */2 * * *` UTC) with Bearer token authentication.
   - **Slot Calculation**: Slot timestamp is rounded to the nearest 2-hour window:
     $$\text{slot} = \lfloor (\text{now} + 15\text{min}) / 2\text{h} \rfloor \times 2\text{h}$$
   - **Idempotency**: Utilizes a Postgres unique partial index `scrape_runs_slot_uq ON (scheduled_slot)`. Duplicate or retried cron webhooks map to the identical slot and are safely skipped with HTTP 200 `{ status: "skipped", reason: "slot_already_handled" }`.
   - **Immediate 202 Acceptance**: Returns HTTP 202 immediately to cron-job.org within ~100 ms to satisfy the cron monitor's 30-second timeout, executing the scrape run asynchronously on the server.
2. **`keep-warm`**: `GET /api/health` every 10 minutes to prevent Render free-tier instance suspension and eliminate cold-start timeouts on cron triggers.

---

## 7. Architectural Trade-offs

| Decision | Trade-off Made | Rationale |
|---|---|---|
| **Strict Both-Fields Policy** | A scrape attempt fails if either price *or* stock fails extraction. | Prevents half-valid or corrupted records from entering the time series. Data integrity supercedes partial availability. |
| **Concurrency = 1** | Scrape runs take ~2–3 minutes for 15 products instead of 30 seconds. | Essential for stability on Render's 512 MB memory limit. Prevents OOM crashes. |
| **Integer Minor Units (`price_minor`)** | Requires conversion math on input/output (e.g. ₹12,842.00 → `1284200`). | Eliminates floating-point precision loss and rounding discrepancies in Postgres. |
| **Separate History & Attempt Logs** | Requires two distinct tables (`price_observations` vs `scrape_attempts`). | Provides complete observability into scraper friction and failure rates without polluting the clean price time series. |

---

## 8. Measured Reliability Results

Results recorded during soak testing against the live store (`docs/verification.md`):

- **Target Products Sampled**: 200, 114, 10, 86, 206
- **Total Scrape Trials**: 10
- **Raw First-Attempt Success Rate**: **80.0%** (8/10)
- **After-Retry Success Rate**: **100.0%** (10/10)
- **Total Retried Attempts**: 6
- **Final Unresolved Failures**: 0
- **Duration Percentiles**:
  - $p_{50}$: 7.60 s
  - $p_{90}$: 70.57 s (reflects full backoff on injected/store 500 delays)
  - $p_{95}$: 70.57 s
- **Database Invariant Check**: Zero invariant violations recorded across all runs.

---

## 9. AI Mistakes & Correction Log

In accordance with Operating Rule R8, all mistakes made by AI during development were recorded with evidence and fixes (reproduced from `docs/ai-mistakes.md`):

1. **Unhandled Dynamic Cookie Overlay Intercepting Clicks**:
   - *Failing Output*: `elementHandle.click: Timeout 30000ms exceeded. <div class="cookie-overlay">...</div> intercepts pointer events`.
   - *Cause*: Assumed the "Reveal Price" button was directly clickable once present. The store dynamically inserts a cookie consent modal that intercepts pointer events and requires multiple clicks to dismiss due to a chaotic internal counter.
   - *Fix*: Created a dedicated `dismissCookieBanner()` routine that checks for `.cookie-overlay` and clicks the dismiss button in a bounded loop until the DOM node is detached.
2. **Premature Wait Condition Producing Empty Quotes**:
   - *Failing Output*: `Saved fixture to fixture-200-*.json (price: undefined, stock: undefined)`.
   - *Cause*: The script listened for `/price` response without scrolling the container into viewport or ensuring mouse hover telemetry met the minimum 8-movement threshold.
   - *Fix*: Added explicit `scrollIntoViewIfNeeded()`, programmatic mouse move jitter satisfying the 8-movement and 600 ms dwell requirement, and a `page.waitForFunction` check for hydrated DOM text.
3. **Store Anti-Bot Attestation Rejection (401) from Clock Skew**:
   - *Failing Output*: `POST /api/session -> 401 Unauthorized; GATE_NOT_PASSED: Store showed error: "challenge_failed"`.
   - *Cause*: Developer machine local system clock was 5.5 hours ahead of the store server's real UTC time. In the browser, `Date.now()` populated `att.env.at` with a future timestamp, which the store server rejected.
   - *Fix*: Implemented `getStoreTimeOffset()` to calculate local vs store server time offset and injected the synchronized delta into the browser context's `Date.now()` and Gate V9 `checkV9Freshness`.
4. **Split-Span Price Digits Parsed as Independent Prices (PRICE_AMBIGUOUS)**:
   - *Failing Output*: `PRICE_AMBIGUOUS: Authoritative quote (973600) and divergent DOM prices (900, 700, 300, 600)`.
   - *Cause*: The store split formatted price strings into single-character `<span>` elements with zero-width spaces. Filtering for leaf nodes (`children.length === 0`) extracted only single digits and omitted the parent price container.
   - *Fix*: Included price containers with inline span children (`isPriceContainer`), ignored isolated short digits without currency symbols, and added fallback cross-checking against lines in `blockText`.
5. **camelCase Payload Causing Database Constraint Failure on observed_at**:
   - *Failing Output*: `null value in column "observed_at" violates not-null constraint (23502)`.
   - *Cause*: Extractor emitted camelCase keys (`observedAt`), while the initial Postgres RPC only checked `p_observation->>'observed_at'`.
   - *Fix*: Mapped fields to snake_case in `repo.js` and added `coalesce` for both camelCase and snake_case in migration `0005_fix_finish_attempt_success.sql`.

---

## 10. Known Limitations

1. **Catalog Snapshot Synchronization**: The local catalog search is backed by a database snapshot. Newly added products to the store will only appear in search after the next full sync (`npm run sync:catalog`).
2. **Free-Tier Cold Starts**: If the keep-warm job is interrupted and the server enters deep sleep, an incoming manual user scrape or health check will experience a 45–60s delay while Render spins up the container.
3. **Product Volume Cap**: The application enforces `MAX_TRACKED = 15` products to guarantee that total run duration never exceeds Render's free execution bounds.
