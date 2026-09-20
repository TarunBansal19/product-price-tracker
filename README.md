# INE Product Price Tracker

An automated web scraper and price-tracking application engineered to monitor product pricing and stock availability on `https://demo.inelabteamdev.com`. Designed for long-term unattended reliability on free-tier infrastructure.

---

## 1. Overview & Key Capabilities

- **Automated 2-Hourly Scrapes**: Triggered by external cron (`cron-job.org`) with idempotent slot claims and automatic recovery.
- **Resilient Gated Extraction**: Handles complex client-side defenses: telemetry tracking (dwell + hover movements), chaotic cookie overlays, rotating CSS classes, decoy prices, and upstream 500 errors.
- **Strict Data Integrity**: Zero fabricated data. Enforces 9 validation gates (V1–V9) and 7 database invariants (I1–I7). Observations are strictly append-only; failed attempts generate detailed error logs and never write placeholder observations.
- **Observable Runs**: Built-in CLI supporting headed mode, step-by-step narrative logging, and labelled fault simulation (`--inject slow|hang|http500|abort`).
- **Clean Architecture**: Node.js ESM backend with Playwright Chromium, Supabase Postgres database with atomic SQL RPC functions, and a minimal, honest React + Vite frontend.

---

## 2. Live Links

- **Live Application (Frontend)**: `https://product-price-tracker-frontend-alpha.vercel.app/` 
- **Backend API**: `https://product-price-tracker-backend-ahkz.onrender.com`
- **Health Check**: `https://product-price-tracker-backend-ahkz.onrender.com/api/health`

---

## 3. Architecture

```
cron-job.org ──(POST /api/cron/tick, every 2h, Bearer secret)──┐
cron-job.org ──(GET /api/health, every 10 min: keep warm)──────┤
                                                               ▼
 React (Vercel) ── REST ──►  Express API (Render)  ──► Supabase Postgres
                               │      ▲                 (tables + RPCs)
                               │      │
                               ▼      │
                      Run orchestrator (async, after 202)
                        └─ per product: jobRunner (retry loop + backoff)
                             └─ priceScraper (Chromium with telemetry emulation)
                                  └─ validation gates (V1–V9) → observation
                               store client ──► demo.inelabteamdev.com ONLY
```

---

## 4. Local Setup & Quick Start

### Prerequisites:
- Node.js ≥ 20
- Supabase account (or local PostgreSQL with `pgcrypto` and `pg_trgm`)

### 1. Clone & Install Dependencies
```bash
git clone https://github.com/your-username/Product-Price-Tracker.git
cd Product-Price-Tracker

# Install backend dependencies & Playwright browsers
cd backend
npm install
npx playwright install chromium

# Install frontend dependencies
cd ../frontend
npm install
```

### 2. Configure Environment Variables
Copy `.env.example` in `backend/`:
```bash
cd ../backend
cp .env.example .env
```
Fill in your Supabase credentials and a secure `CRON_SECRET`.

### 3. Apply Database Migrations
Run the SQL migration scripts located in `supabase/migrations/` in your Supabase SQL Editor:
1. `supabase/migrations/0001_init.sql` (creates schema, tables, indexes, and RLS)
2. `supabase/migrations/0002_rpc.sql` (creates atomic RPC functions for slot claiming, leases, and attempt tracking)

### 4. Sync Initial Catalog Snapshot
```bash
cd backend
npm run sync:catalog
```

### 5. Run Development Servers
```bash
# Start backend on port 3001
cd backend
npm run dev

# In a separate terminal, start frontend on port 5173
cd frontend
npm run dev
```
Open `http://localhost:5173` in your browser.

---

## 5. Environment Variables (`backend/.env`)

| Variable | Example / Default | Description |
|---|---|---|
| `NODE_ENV` | `development` / `production` | Node environment |
| `PORT` | `3001` | Server port (Render sets this automatically) |
| `SUPABASE_URL` | `https://xxxx.supabase.co` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | *(secret)* | Supabase service-role key (backend only) |
| `CRON_SECRET` | *(min 32 chars)* | Secret token for `/api/cron/tick` and `/api/admin/*` |
| `FRONTEND_ORIGINS` | `http://localhost:5173,https://your-app.vercel.app` | CORS allow-list (comma-separated) |
| `STORE_ORIGIN` | `https://demo.inelabteamdev.com` | Strict store origin (Rule R4) |
| `MAX_TRACKED` | `15` | Maximum active tracked products |
| `SCRAPE_INTERVAL_HOURS` | `2` | Interval slot size (2 hours) |
| `ATTEMPT_TIMEOUT_MS` | `30000` | Hard timeout per attempt |
| `MAX_ATTEMPTS` | `4` | Maximum retry attempts per job |
| `BACKOFF_BASE_MS` | `1500` | Exponential backoff base (ms) |
| `BACKOFF_MAX_MS` | `15000` | Exponential backoff cap (ms) |
| `JOB_DEADLINE_MS` | `120000` | Per-product job deadline (2 minutes) |
| `RUN_DEADLINE_MS` | `1500000` | Total run deadline (25 minutes) |
| `CONCURRENCY` | `1` | Concurrency limit (bounds memory to < 384 MB) |
| `STABILITY_MS` | `2000` | Stability observation window (ms) |
| `OUTLIER_PCT` | `35` | Outlier deviation threshold (%) |
| `LOG_LEVEL` | `info` | Pino log level |

Frontend configuration:
| Variable | Example | Description |
|---|---|---|
| `VITE_API_BASE_URL` | `https://your-backend.onrender.com/api` | Base URL for backend API calls |

---

## 6. Scraping Schedule & Cron Setup

To maintain unattended runs on free-tier hosting, set up two jobs in [cron-job.org](https://cron-job.org):

| Job Name | URL | Schedule (UTC) | Method & Headers | Purpose |
|---|---|---|---|---|
| **`scrape-tick`** | `https://<render-url>/api/cron/tick` | `0 */2 * * *` (Every 2 hours) | `POST`<br>`Authorization: Bearer <CRON_SECRET>` | Triggers unattended scrape run. Slot is rounded and idempotent. |
| **`keep-warm`** | `https://<render-url>/api/health` | `*/10 * * * *` (Every 10 min) | `GET` | Prevents container from sleeping and avoids tick cold starts. |

*Note: In cron-job.org, enable "Save responses in history" for `scrape-tick` to maintain independent audit logs.*

---

## 7. Observable CLI & Headed Run Instructions

The CLI runner provides an observable, narrative stream demonstrating the full extraction cycle:

```bash
cd backend

# Run headless against product 200
npm run scrape -- --ids 200

# Run in HEADED mode with slow-motion (250ms) to observe browser interaction
npm run scrape -- --ids 200,114 --headed --slowmo 250

# Simulate upstream network faults (isolated to CLI only, never combined with --persist)
npm run scrape -- --ids 200 --inject slow
npm run scrape -- --ids 200 --inject http500
npm run scrape -- --ids 200 --inject hang

# Persist CLI scrape results to the database
npm run scrape -- --ids 200 --persist
```

---

## 8. Testing & Verification Commands

```bash
cd backend

# Run all unit and fault tests
npm test

# Run pure unit tests (normalizer, parsers, validation gates V1–V9)
npm run test:unit

# Run fault tests (backoff, withTimeout, never-settling promise, circuit breaker)
npm run test:fault

# Run reliability soak against the live store
npm run probe -- --ids 200,114,10,86,206 --rounds 2

# Verify all database invariants (I1–I7) on live database
npm run verify:db
```

---

## 9. Deployment Instructions

### Backend (Render Docker Web Service)
1. In Render, create a new **Web Service** pointing to your repository.
2. Select **Docker** environment (Render uses `backend/Dockerfile` using `mcr.microsoft.com/playwright:v1.50.1-noble`).
3. Set **Root Directory** to `backend`.
4. Set **Health Check Path** to `/api/health`.
5. Add all required environment variables (§5).

### Frontend (Vercel)
1. In Vercel, import your GitHub repository.
2. Set **Root Directory** to `frontend`.
3. Set **Framework Preset** to `Vite`.
4. Add environment variable `VITE_API_BASE_URL=https://<your-render-url>/api`.
5. Deploy.

---

## 10. Known Limitations

- **Free-Tier Cold Starts**: When the backend sleeps (if the keep-warm monitor experiences gaps), initial requests may take up to 60 seconds. The frontend features an automatic wakeup retry banner.
- **Sequential Concurrency**: To remain safely within Render's 512 MB memory limit, scraping runs with `CONCURRENCY = 1`. A full 15-product cycle requires ~2–3 minutes.
- **Catalog Snapshot**: Search queries the stored database snapshot; sync new store additions periodically using `npm run sync:catalog`.
