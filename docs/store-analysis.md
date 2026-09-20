# Store Analysis — demo.inelabteamdev.com

> Generated during Phase 0 Reconnaissance from live measurements, network traces, and client bundle reverse-engineering.

---

## Executive Summary & Strategy Decision

- **Store Target**: `https://demo.inelabteamdev.com`
- **Catalog Strategy**: **HTTP Client** (`GET /api/catalog?page=N&pageSize=M`). Fast, lightweight, zero browser overhead.
- **Price/Stock Scraping Strategy**: **Browser via Playwright (Branch A)**.
  - *Evidence*: The price endpoint is gated behind interactive mouse telemetry (`minMoves: 8`, `minDwellMs: 600`), dynamic WebAssembly proof-of-work computation (`difficulty` nonce search in SHA256 + WASM instantiation), short-lived session tokens, XOR ciphertext decryption with hashed salt keys, and random cookie banner interruptions.
  - Attempting to reproduce the full client PoW + WASM in pure Node HTTP is brittle across bundle updates, whereas Playwright natively handles the WebAssembly runtime and telemetry while providing cross-checking against visible DOM elements and enabling the required headed demo mode.
- **Observed First-Attempt Failure Rate**: **30.0%** (21/30 successes, 9/30 failures across 30 empirical trials).
- **Observed Latency (p50 / p90 / p95 / p99)**:
  - p50: **6,053 ms** (~6.1 s)
  - p90: **8,426 ms** (~8.4 s)
  - p95: **8,428 ms** (~8.4 s)
  - p99: **8,673 ms** (~8.7 s)
  - Timeout threshold set to **30,000 ms** (provides >3× margin over p99).

---

## Detailed Answers to Phase 0 Questions (Q1 – Q12)

### Q1: Catalog exposure, pagination, count, ID format, and search
- **Endpoint**: `GET /api/catalog?page=N&pageSize=M`
- **Total Products**: `1000` items across `pages` (e.g. 50 pages at pageSize 20, 200 pages at pageSize 5).
- **Product ID**: Positive integer (e.g., `200`, `114`, `10`, `14`, `86`, `206`, `776`, `50`).
- **Product Schema**:
  ```json
  {
    "id": 200,
    "slug": "helix-docking-station-air",
    "name": "Helix Docking Station Air",
    "brand": "Helix",
    "category": "Peripherals",
    "sku": "HEL-10200",
    "description": "..."
  }
  ```
- **Price / Stock in Catalog**: **None**. Prices and stock are completely absent from catalog responses.
- **Search Capability**: Store frontend does purely client-side browsing (`fetch(/api/catalog?page=${page})`). No server-side search query parameter exists (`?q=...` is ignored). Search must be implemented in our backend via normalized snapshot (`catalog_products` table in Postgres).

### Q2: Product page URL pattern & server rendering
- **URL Pattern**: `https://demo.inelabteamdev.com/product/:id`
- **Rendering**: Client-rendered React SPA. Initial GET `/product/:id` returns a minimal HTML shell with `<div id="root"></div>`. No product text, price, or stock is server-rendered.

### Q3: Price origin, gating, PoW, headers, and tokens
- **Origin**: Price data is loaded via a gated JSON request:
  `GET /api/products/:id/price` with header `Authorization: Bearer <session_token>`.
- **Gating Mechanism**:
  1. **Telemetry**: Client tracks mouse movements (`Ar` class in bundle) requiring `minMoves: 8` and `minDwellMs: 600` inside `.price-block`.
  2. **Challenge**: `GET /api/challenge` returns `{ salt, ts, difficulty, csig, wasm }`.
  3. **WASM + Proof of Work**:
     - Client compiles and instantiates dynamic WebAssembly binary (`WebAssembly.compile(wasm)`).
     - Solves SHA256 difficulty nonce search (`000...`).
     - Evaluates WASM export `f(seed)`.
  4. **Session Token**: `POST /api/session` submits telemetry + PoW solution + canvas fingerprint hash -> returns `{ token }`.
  5. **Encrypted Payload**: `GET /api/products/:id/price` returns `{ productId, v: 1, e: "<ciphertext>", serverTime }`.
  6. **Decryption**: Decrypted using XOR with key derived from hash(`lr + salt + token`), producing JSON `{ p, m, s, c, t, r, rc, sl, dd, v, g, f, x }`.
     - `p`: Price integer minor/major
     - `m`: MRP (list price)
     - `s`: Stock quantity
     - `c`: Currency code (`INR`)
     - `t`: Timestamp of quote
     - `f`: Format variant (`spaced`, `euro`, `trailing`, `unicode`, `nbsp`, `lakh`, standard)

### Q4: Real price vs. decoys & stable signals
- **Visible Real Price**: Rendered in `.price-block` without strike-through, computed style `display !== 'none'`, `visibility !== 'hidden'`, `opacity !== '0'`.
- **Decoys Identified**:
  - **MRP Decoy**: Strike-through element (`text-decoration: line-through`), e.g. `[SPAN .mr-*] "₹12,956"`.
  - **Hidden DOM Decoys**: Elements with `display: none` or `.price-value`, `.amount` containing false prices (e.g. `₹15,206`).
  - **Discount Badges**: Text like `"19% off"` or `"23% off"`.
- **Authoritative Source**: The decrypted quote object intercepted directly from the client's `JSON.parse` invocation (`p`, `m`, `s`, `c`). Cross-checked with the normalized visible DOM price.

### Q5: Stock phrasings & vocabulary
- **Observed Vocabulary**:
  - In Stock: `In stock · ${N} left`, `Only ${N} left`, `${N} in stock`, `Selling fast — ${N} left`, `Hurry, just ${N} left`.
  - Out of Stock: `Out of stock` (observed when `stock === 0`, e.g. product 206 and product 14).
- **Normalized DB Enum**:
  - `in_stock` (quantity > 10)
  - `low_stock` (quantity <= 10 or phrasing indicates urgency: "Only", "Selling fast", "Hurry")
  - `out_of_stock` (quantity = 0 or text "Out of stock")

### Q6: Price change cadence
- Sampled over consecutive loads across 2.5 minutes:
  - Product 200 initially quoted `13231`, then settled to `9199` for subsequent quotes.
  - Stock remained constant at `96`.
  - Presentation format cycled through `euro`, `spaced`, `lakh`, and standard.
  - Conclusion: Prices fluctuate between quotes/sessions, but maintain internal consistency during a given session. Re-read stability check (`STABILITY_MS`) must compare against authoritative quote timestamp and tolerate format shifts.

### Q7: Latency & failure profile (30 empirical trials)
- Total Trials: 30
- Successes: 21 (70.0%)
- Failures: 9 (30.0%)
- Latency Distribution of Successes:
  - Min: 5,054 ms
  - p50: 6,053 ms
  - p90: 8,426 ms
  - p95: 8,428 ms
  - p99: 8,673 ms
  - Max: 8,673 ms
- Failure Kinds:
  - `Timeout 12000ms`: Delayed client network response / transient store delay (78% of failures).
  - `Click timeout`: Cookie banner modal intercepting pointer events right before action (22% of failures).

### Q8: Asynchronous placeholders & delays
- Initial state: `.price-idle`, "Price hidden", "Check the current price and availability.", "Hover over the price area to load the current price."
- Reveal button: `<button aria-label="Reveal price">` disabled until hover telemetry requirements are satisfied.
- In flight: `.price-block[aria-busy="true"]`, `.spinner`, "Loading current price...", or "Retrying (attempt N/6)..."
- Failed state: `.price-error`, "Couldn't load the price after N attempts."

### Q9: Headless vs. Headed
- Both modes behave identically with flags `--no-sandbox --disable-dev-shm-usage --disable-gpu`.
- Browser-based telemetry and WebAssembly execute successfully in headless mode.

### Q10: Rate-limiting & Cookie Overlays
- **Cookie Overlay**: `<div class="cookie-overlay">` appears dynamically with ~25% probability.
  - Internal counter `Jr()` requires 1, 2, or 3 clicks on "Accept" (`button[aria-label="Accept cookies"]`) to dismiss!
  - Scraper must proactively detect and click the accept button in a loop until `.cookie-overlay` is completely removed.
- **Rate-limits**: 429 response handled with backoff.

### Q11: Extra product info available
- Brand, category, SKU, description, specs (warranty, country of origin, in-the-box, returns, weight), reviews, ratings, ratingCount, seller name, deliveryDays estimate.

### Q12: DOM stability & class name rotation
- CSS classes rotate dynamically (e.g. `pw-a7`, `v2s4mdl`, `mr-a7`, `bd-a7`, `st-a7`).
- Scraper MUST NOT rely on generated utility classes.
- Stable anchors:
  - `button[aria-label="Reveal price"]`
  - `.price-block`
  - Computed styles (`text-decoration: line-through` vs `none`, `visibility: visible`)
  - Authoritative quote payload intercepted at `JSON.parse`.
