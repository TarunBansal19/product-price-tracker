# AI Mistakes & Lessons Learned Log

> Maintained per Rule R8. Every time an AI-generated first attempt is wrong, it is logged with real evidence and the exact fix. Never invent entries.

---

### Entry 1: Unhandled Dynamic Cookie Overlay Caused Click Timeout in Recon
- **Date/Time**: 2026-09-20T11:59:34Z
- **Trigger**: Running `node src/cli/recon.js --id 200 --headless`.
- **Failing Output**:
  ```
  [recon] Reveal price button found. Disabled: false
  [recon] Clicking Reveal price button...
  [recon] Fatal error: elementHandle.click: Timeout 30000ms exceeded.
  Call log:
    - attempting click action
    - <div class="cookie-overlay">…</div> intercepts pointer events
  ```
- **Root Cause**: The first attempt assumed clicking the "Reveal price" button could proceed immediately once enabled. However, the store injects a `<div class="cookie-overlay">` overlay that intercepts clicks. Looking at the client bundle, the cookie modal uses an intentional chaotic counter `Jr()` where the modal only closes after 1, 2, or 3 clicks on the Accept/Decline button!
- **Fix**: Added a resilient `dismissCookieBanner()` function that polls for `.cookie-overlay` and clicks `button[aria-label="Accept cookies"]` in a loop until the overlay is completely removed from the DOM before attempting any interaction.
- **Verification**: Ran `node src/cli/recon.js --id 200 --headless`; successfully dismissed the overlay in 2 clicks and extracted the price cleanly.

---

### Entry 2: Premature Wait Condition in Capture Fixtures Caused Empty Quotes
- **Date/Time**: 2026-09-20T12:04:50Z
- **Trigger**: Running `capture-fixtures.js` round 1 on product 200 and 14.
- **Failing Output**:
  ```
  [capture] Saved fixture to fixture-200-1789885957943.json (price: undefined, stock: undefined)
  ```
- **Root Cause**: The capture script relied on `page.waitForResponse` for `/price`, but did not check if the reveal button click was intercepted or if the price block was scrolled into view before mouse hover events were dispatched.
- **Fix**: Ensured `block.scrollIntoViewIfNeeded()` was called, repeated mouse move jitter to guarantee `minMoves: 8` and `minDwellMs: 600`, and added explicit `page.waitForFunction` waiting for hydrated state with retries.
- **Verification**: Captured valid fixtures across varied products with 100% price and stock extraction in subsequent runs.

---

### Entry 3: Store Anti-Bot Attestation Rejection (401) Caused by Local Clock Skew
- **Date/Time**: 2026-09-20T17:23:45Z
- **Trigger**: Running `npm run scrape -- --ids 200 --persist`.
- **Failing Output**:
  ```
  [REQ] POST https://demo.inelabteamdev.com/api/session
  [RES] 401 https://demo.inelabteamdev.com/api/session
  [RES BODY] {"error":"unauthorized"}
  product 200 attempt 1/4 → GATE_NOT_PASSED: Store showed error: "Couldn’t load the price after 1 attempts. challenge_failed"
  ```
- **Root Cause**: The developer environment system clock was skewed 5.5 hours ahead of the store server's real UTC time. In the browser, the store's anti-bot bundle calls `Date.now()` to populate `att.env.at` and `att.ix.clickAt`. When submitted to `POST /api/session`, the store server detected that the attestation timestamp was ~19,650 seconds in the future relative to the challenge's `ts` timestamp and rejected it as unauthorized.
- **Fix**: Added `getStoreTimeOffset()` in `browserPool.js` to measure the clock delta between the local system and the store server's challenge endpoint. Injected an init script into the browser context overriding `Date.now()` by applying `offset` so the browser runtime matches the store's clock, and updated Gate V9 (`checkV9Freshness`) to evaluate quote age relative to synchronized time.
- **Verification**: Ran `node test/scratch-sync.js`; `/api/session` immediately returned `200 OK` with session token, and real price hydrated on page.

---

### Entry 4: Split-Span Price Digits Parsed as Independent Prices (PRICE_AMBIGUOUS)
- **Date/Time**: 2026-09-20T17:26:50Z
- **Trigger**: Running `npm run scrape -- --ids 200`.
- **Failing Output**:
  ```
  product 200 attempt 1/4 → PRICE_AMBIGUOUS: Authoritative quote (973600) and divergent DOM prices (900, 700, 300, 600)
  ```
- **Root Cause**: The store splits formatted price strings into individual character `<span>` tags (e.g. `<span>9</span><span>,</span><span>7</span>...`). The DOM candidate extractor filtered strictly for leaf nodes (`el.children.length === 0`). As a result, the parent container holding the entire price (`₹9,736`) was rejected because it had child elements, while individual leaf spans containing single digits (`9`, `7`, `3`, `6`) were extracted. `parsePrice` then treated each digit as a separate price candidate (`900`, `700`, `300`, `600`), causing a false `PRICE_AMBIGUOUS` divergence error against the real quote (`973600`).
- **Fix**: Updated `priceScraper.js` candidate selection to include price container elements whose children are inline formatting spans (`isPriceContainer`). In `pickPrice.js`, ignored isolated digits `<= 3` characters without currency symbols, and added a cross-check against lines in `blockText`.
- **Verification**: Re-ran `npm run scrape -- --ids 200`; price was cleanly parsed as `9736 INR` and matched the authoritative quote with `cross_checked=true`.

---

### Entry 5: camelCase Payload Causing Null Constraint Failure on observed_at
- **Date/Time**: 2026-09-20T17:29:51Z
- **Trigger**: Running `npm run scrape -- --ids 200 --persist`.
- **Failing Output**:
  ```
  [jobRunner] CRITICAL: DB write failed for successful attempt: RPC finish_attempt_success failed: null value in column "observed_at" of relation "price_observations" violates not-null constraint (23502)
  ```
- **Root Cause**: The pure scraper returned JavaScript camelCase properties (`observedAt`, `priceMinor`), but the Postgres RPC `finish_attempt_success` expected snake_case (`p_observation->>'observed_at'`). Postgres evaluated the expression to NULL and failed the table constraint.
- **Fix**: Mapped all observation fields to snake_case in `backend/src/db/repo.js` before calling the RPC, and created migration `0005_fix_finish_attempt_success.sql` using `coalesce(p_observation->>'observed_at', p_observation->>'observedAt')` to robustly accept both naming conventions.
- **Verification**: Re-ran `npm run scrape -- --ids 200 --persist`; observation was successfully inserted into `price_observations` and Invariants I1–I7 passed 100%.

