# Product Price Tracker (Web Scraping Assignment)

A resilient, production-grade full-stack web application built for the **INE Software Engineer Intern Assignment**. It monitors and tracks product pricing and stock availability over time from INE's hosted mock store (`https://demo.inelabteamdev.com`), engineered specifically for long-term unattended reliability on free-tier infrastructure.

---

## 1. Live Deployment & Links

- **Live Application (Frontend)**: [https://product-price-tracker-frontend-alpha.vercel.app](https://product-price-tracker-frontend-alpha.vercel.app) *(Vercel)*
- **Backend API**: [https://product-price-tracker-backend-ahkz.onrender.com](https://product-price-tracker-backend-ahkz.onrender.com) *(Render Docker)*
- **API Health Check**: [https://product-price-tracker-backend-ahkz.onrender.com/api/health/live](https://product-price-tracker-backend-ahkz.onrender.com/api/health/live)
- **Target Mock Store**: [https://demo.inelabteamdev.com](https://demo.inelabteamdev.com)

---

## 2. Tech Stack & Architecture

- **Frontend**: React.js (Vite, Tailwind CSS, lightweight Lucide icons) deployed on **Vercel**.
- **Backend**: Node.js (Express, ESM, Zod, Pino logging) deployed as a containerized service on **Render**.
- **Database**: **Supabase (PostgreSQL)** with atomic SQL RPCs, Row-Level Security (RLS), and database invariants.
- **Scraping Engine**: **Playwright (Chromium)** with interaction telemetry emulation, dynamic store-clock drift synchronization, and memory-bounded browser recycling.
- **Scheduling**: External cron via **cron-job.org** with keep-warm pings and slot-based idempotent execution.
- **CI/CD**: **GitHub Actions** running 53 automated unit and fault tests on every push.

```
                   cron-job.org
        ┌───────────────┴───────────────┐
        │ POST /api/cron/tick (every 2h)│ GET /api/health/live (every 10 min)
        ▼                               ▼
  ┌───────────────────────────────────────────┐
  │         Node.js Express (Render)          │ ◄──── REST API ──── React Frontend
  │  - Slot-based idempotent scheduler        │                       (Vercel)
  │  - Job runner with exponential backoff    │
  │  - Circuit breaker (infra tripwire)       │
  │  - Structure drift fingerprinting         │
  └─────────────────────┬─────────────────────┘
                        │
        ┌───────────────┴───────────────┐
        ▼                               ▼
 ┌──────────────┐             ┌──────────────────┐
 │   Supabase   │             │    Playwright    │
 │  PostgreSQL  │             │   Chromium Pool  │
 │  (Atomic     │             └────────┬─────────┘
 │   RPCs)      │                      ▼
 └──────────────┘             https://demo.inelabteamdev.com
```

---

## 3. Core Features (Per Assignment Requirements)

### 1. Product Selection & Catalog Search
- Real-time search across INE's hosted store catalog by partial or full product name.
- Track products with a single click, persisting tracked items in Supabase.
- Enforces strict limits (`MAX_TRACKED = 15`) to prevent runaway resource consumption.

### 2. Scheduled Scraping (The Core Challenge)
- Automatically scrapes tracked products once every **2 hours**.
- **Idempotent Slot Claiming**: Scrape slots are deterministically rounded to 2-hour boundaries. Duplicate cron ticks or retries never produce duplicate runs.
- **Free-Tier Sleep Handling**: Triggered by external webhook (`POST /api/cron/tick`). Includes a 10-minute keep-warm ping to eliminate cold starts.
- **Bounded Concurrency (`CONCURRENCY = 1`)**: Sequential product processing ensures memory stays strictly under 384 MB (safely within Render’s 512 MB free tier).

### 3. Price History & Honest Scrape Log
- Interactive history view displaying price trends and stock availability states over time.
- **Honest Attempt Logging**: Every attempt records its exact outcome (`success`, `retried`, or `failed`), duration, HTTP status, and error classification.
- **Zero Fabricated Data**: Failed attempts **never** write dummy prices or empty observations.

### 4. Observable (Headed) Mode & Fault Simulation
- Built-in CLI supporting `--headed` and `--slowmo` to watch browser interaction live.
- Boundary fault injection flags (`--inject slow|http500|hang|abort`) demonstrating real-time retry recovery and backoff.

### 5. Bonus Features Implemented
- 🛡️ **Store Page Structure Change Detection**: Computes SHA-256 structural fingerprints of page layouts, DOM hierarchies, and quote schemas to alert on store revisions before scrapers fail.
- 🤖 **CI/CD Pipeline with GitHub Actions**: Automatically validates 53 tests on every push and pull request against saved real fixtures.
- ⚡ **Circuit Breaker**: Detects prolonged store-wide outages and fast-fails remaining jobs to conserve resources.
- 🔔 **Catalog Enrichment**: Displays product specifications, ratings, categories, and stock indicators on the dashboard.

---

## 4. Scraping Schedule & Cron Configuration

Because free-tier instances sleep when idle, scheduling is handled externally via **cron-job.org**:

| Job Name | Target URL | Schedule (UTC) | Method & Auth | Purpose |
|---|---|---|---|---|
| **`scrape-tick`** | `https://<render-url>/api/cron/tick` | `0 */2 * * *` (Every 2h) | `POST`<br>`Authorization: Bearer <CRON_SECRET>` | Triggers 2-hourly scrape cycle. Slot is rounded and idempotent. Returns `202 Accepted` immediately. |
| **`keep-warm`** | `https://<render-url>/api/health/live` | `*/10 * * * *` (Every 10m) | `GET` | Prevents Render container from sleeping, eliminating tick cold starts. |

---

## 5. Environment Variables

### Backend (`backend/.env`)

| Variable | Example / Default | Required | Description |
|---|---|:---:|---|
| `NODE_ENV` | `production` / `development` | Yes | Node runtime environment |
| `PORT` | `3001` (or `10000` on Render) | Yes | HTTP server port |
| `SUPABASE_URL` | `https://xxxx.supabase.co` | Yes | Supabase PostgreSQL project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | `eyJhbGciOi...` | Yes | Service-role key with permissions to execute RPCs |
| `CRON_SECRET` | `min-32-char-random-string` | Yes | Bearer token protecting `/api/cron/tick` and admin endpoints |
| `FRONTEND_ORIGINS` | `https://your-app.vercel.app,http://localhost:5173` | Yes | Allowed origins for CORS |
| `STORE_ORIGIN` | `https://demo.inelabteamdev.com` | Yes | Strict store origin (SSRF protection) |
| `MAX_TRACKED` | `15` | No | Max active products allowed to be tracked |
| `SCRAPE_INTERVAL_HOURS` | `2` | No | Interval between scheduled runs |
| `ATTEMPT_TIMEOUT_MS` | `45000` | No | Timeout per single scrape attempt (ms) |
| `MAX_ATTEMPTS` | `4` | No | Maximum retry attempts before marking product failed |
| `BACKOFF_BASE_MS` | `1500` | No | Exponential backoff base delay (ms) |
| `BACKOFF_MAX_MS` | `15000` | No | Max delay cap between retries (ms) |
| `JOB_DEADLINE_MS` | `120000` | No | Max runtime per product across all retries (2 min) |
| `RUN_DEADLINE_MS` | `1500000` | No | Total deadline for an entire run (25 min) |
| `CONCURRENCY` | `1` | No | Concurrent browser contexts (1 bounds RAM) |
| `OUTLIER_PCT` | `35` | No | Percentage price jump requiring second-read confirmation |
| `HEADED` | `false` | No | Run browser visibly (for local debugging) |
| `SLOW_MO_MS` | `0` | No | Delay between Playwright actions (ms) |
| `LOG_LEVEL` | `info` | No | Pino logging level (`info`, `debug`, `trace`) |

### Frontend (`frontend/.env`)

| Variable | Example / Default | Required | Description |
|---|---|:---:|---|
| `VITE_API_BASE_URL` | `https://<render-url>/api` | Yes | Base URL pointing to the deployed backend API |

---

## 6. Local Setup & Quick Start

### Prerequisites
- Node.js ≥ 20
- npm ≥ 10

### 1. Clone & Install
```bash
git clone https://github.com/TarunBansal19/product-price-tracker.git
cd product-price-tracker

# Install backend dependencies & Playwright browser
cd backend
npm install
npx playwright install chromium

# Install frontend dependencies
cd ../frontend
npm install
```

### 2. Environment Configuration
```bash
# In backend/
cp .env.example .env
# Edit backend/.env with your Supabase credentials and CRON_SECRET

# In frontend/
cp .env.example .env
# Set VITE_API_BASE_URL=http://localhost:3001/api
```

### 3. Database Setup (Supabase)
Execute migrations in the Supabase SQL Editor in order:
1. `supabase/migrations/0001_init.sql`
2. `supabase/migrations/0002_rpc.sql`
3. `supabase/migrations/0003_sweep_stale_fix.sql`
4. `supabase/migrations/0004_fix_sweep_ambiguous.sql`

Sync the initial store catalog:
```bash
cd backend
npm run sync:catalog
```

### 4. Run Development Servers
```bash
# Terminal 1: Backend
cd backend
npm run dev

# Terminal 2: Frontend
cd frontend
npm run dev
```
Open `http://localhost:5173` to test the application.

---

## 7. Observable Headed Run & Verification

Run the scraper visibly with full narrative output:

```bash
cd backend

# Standard observable headed scrape (product 200 with 300ms slow-motion)
node src/cli/scrape.js --ids 200 --headed --slowmo 300

# Demonstrate handling of SLOW responses (simulates 5s network delay)
node src/cli/scrape.js --ids 200 --headed --slowmo 300 --inject slow

# Demonstrate handling of FAILING responses (simulates HTTP 500 on attempt 1, backs off, retries & recovers on attempt 2)
node src/cli/scrape.js --ids 200 --headed --slowmo 300 --inject http500

# Run full test suite (53 tests: unit, fault, change detection, invariants)
npm test

# Run change detection baseline update
npm run baseline:update
```

---

## 8. Short Design Note

### How Scraping Reliability Was Achieved
1. **Dynamic Server Clock Synchronization**: The mock store requires cryptographic proof-of-work and time-sensitive session attestations. To prevent local or server clock drift from causing HTTP 401s, `browserPool.js` dynamically syncs with the store server’s timestamp (`/api/challenge`) and injects an aligned `Date.now()` into the browser context.
2. **Realistic Interaction Telemetry**: The store disables the "Reveal price" button until mouse dwell and movement thresholds are satisfied. The scraper computes element bounding boxes and dispatches realistic mouse curves before triggering the click.
3. **Multi-Source Cross-Checking & 9 Validation Gates (V1–V9)**: Prices are decrypted from WebSocket/XHR payloads (`window.__quotes`) and cross-checked against visible DOM candidates. Scrapes pass through 9 strict validation gates (readiness, sanity bounds, currency matching, outlier detection) before reaching the database.
4. **Resilient Retry Loop with Jittered Backoff**: Network or transient errors trigger bounded exponential backoff (`t = min(max_ms, base * 2^attempt + jitter)`). Failed attempts are recorded honestly in the database audit log.

### Key Trade-Offs Made
- **Sequential Execution vs. Concurrency**: We chose `CONCURRENCY = 1` rather than parallel browser contexts. While this takes ~2 minutes for 15 products, it strictly caps memory at ~350 MB, preventing Render's 512 MB free-tier container from being killed by the OOM killer.
- **Headless Browser vs. Raw HTTP**: While catalog searches use fast, lightweight HTTP fetches, price extraction requires Playwright Chromium because the store relies on dynamic WebAssembly, canvas fingerprinting, and client-side decryption.

### What AI Tools Got Wrong on First Attempt & How We Corrected It
- **Split-Span Price Digits**: Initial AI-generated selector logic looked for leaf text nodes (`children.length === 0`). However, the mock store intentionally splits prices across multiple `<span>` elements with zero-width spaces (e.g., `<span>9</span><span>,</span><span>7</span>`). The AI code extracted each digit as an independent price, triggering false divergence errors. We fixed this by introducing container-level price recognition and Unicode NFKC normalization.
- **Dangling Retries Invariant**: The initial retry runner marked intermediate attempts as `retried`. If the process was terminated mid-run, the final attempt remained dangling as `retried`, violating database invariant I6. We resolved this by implementing an atomic database sweeper function (`sweep_stale()`) that reconciles interrupted runs upon server restart.
