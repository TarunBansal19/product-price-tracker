# frontend-spec.md — Tally UI (from the Figma design)

Figma file: https://www.figma.com/design/4QHkHlUm3sh9LW6YufQCbY/Tally-price-tracker-UI
- Frame 1, product detail: node-id=1-16
- Frame 2, search while typing + empty state: node-id=8-2

PNG exports of both frames live in `docs/design/` (`frame-1-product-detail.png`, `frame-2-search-and-empty.png`). **Look at the PNGs first, then use this file for exact numbers.** Do not use the Figma MCP (the owner's Figma plan allows only 6 tool calls per month).

Scope: **base features only**. Desktop layout first, then basic responsive. Frontend must stay small: React + Vite, plain CSS (CSS variables), no UI kit.

---

## 0. Rules for the agent

1. **All numbers, names, dates and statuses in the Figma are SAMPLE content for layout.** Never copy them into the app. The app shows only real data from the backend API. Where data is missing, show an honest empty state.
2. **No mock data, no fake fallbacks, no seed data** anywhere in the frontend.
3. Match the design closely: spacing, type sizes, colours, radii. If something is not covered here or in the PNGs, choose the simplest option and note it in a `docs/frontend-notes.md` file.
4. Keep the code small and explainable. The owner may be asked to change it live in an interview. Small components, clear names, comments on *why*.
5. Times are shown in **IST (Asia/Kolkata)**; put the UTC time in a `title` tooltip.
6. Prices come from the API as integer minor units plus a currency code. Format with `Intl.NumberFormat('en-IN', { style: 'currency', currency })`. Never use floats for money maths.

---

## 1. Design tokens

### Colours (CSS variables; names match the Figma variables `color/<name>`)
| Variable | Hex | Use |
|---|---|---|
| `--paper` | `#E8EDEB` | Left rail background, segmented-control background, hover row |
| `--sheet` | `#FFFFFF` | Main workspace, selected row, inputs, dropdown |
| `--ink` | `#13232B` | Main text, price line, primary outlines, tooltip background |
| `--slate` | `#5C6C73` | Secondary text |
| `--muted` | `#8A979C` | Placeholders, hints, sparklines (unselected), "out of stock" dot |
| `--grid` | `#D9E0DE` | Hairlines, borders, chart gridlines |
| `--live` | `#0E7C66` | Success, in stock, focus ring, price-down text |
| `--live-tint` | `#D6EAE3` | Success badge background |
| `--amber` | `#C7860F` | Retried, low stock |
| `--amber-tint` | `#F5E6C4` | Retried badge background, tooltip outcome text |
| `--red` | `#C43A2C` | Failed |
| `--red-tint` | `#F6DAD5` | Failed badge background |
| `--quiet-tint` | `#DDE3E1` | Neutral tint |

Chart-only colours: stock band in stock `#BFE0D5`, low stock `#F0D9A0`, out of stock `#D3DAD8`, unknown (no data) = no fill + 1px dashed `#AEBAB7`. Day ticks `#B4BFBC`.

### Fonts
- **Bricolage Grotesque** (SemiBold 600, Medium 500): wordmark, page title, big price, section titles, tooltip price, empty-state title. Install with Fontsource (`@fontsource-variable/bricolage-grotesque`) or Google Fonts.
- **IBM Plex Sans** (Regular 400, Medium 500, SemiBold 600): everything else. Install `@fontsource/ibm-plex-sans` weights 400, 500, 600.
- Use `font-variant-numeric: tabular-nums` for prices, times and table numbers.
- Fallbacks: `system-ui, sans-serif`.

### Type scale (px)
| Role | Font | Size | Weight | Letter spacing |
|---|---|---|---|---|
| Wordmark "Tally" | Bricolage | 26 | 600 | -0.5 |
| Big price | Bricolage | 52 | 600 | -1.4 |
| Empty-state title | Bricolage | 40 | 600 | -1 |
| Product title | Bricolage | 36 | 600 | -0.9 |
| Section title (chart, log) | Bricolage | 22 | 500 | -0.3 |
| Rail section title "Tracking" | Bricolage | 17 | 500 | 0 |
| Tooltip price | Bricolage | 22 | 600 | -0.4 |
| Body / table / buttons | Plex | 14 | 400 or 500 | 0 |
| Price summary sentence | Plex | 15 | 400 | 0 |
| Empty-state body | Plex | 16 | 400 | 0 |
| Small text, axis labels, legend | Plex | 12–13 | 400 or 500 | 0 |

Sentence case everywhere. **No ALL CAPS labels, no middle-dot lists, no arrows on buttons.**

### Spacing and shape
- Radii: inputs and buttons 8, rows in the rail 8, dropdown 10, dropdown rows 6, small buttons 6, segmented control 8 with inner options 6, badges fully round (999), tooltip 8, chart band segments 3.
- No card shadows. The only shadow in the whole design is the autocomplete dropdown: `0 8px 24px rgba(19,35,43,0.12)`.
- Borders are 1px `--grid`.

---

## 2. Layout (desktop, 1440 wide reference)

Two columns, full viewport height:
- **Rail**: 320px wide, background `--paper`, padding `28px 24px 24px`, vertical gap 24.
- **Main**: fills the rest, background `--sheet`, padding `40px 48px`, vertical gap 28. At 1440 the content width is 1024px.

### Rail, top to bottom
1. **Wordmark**: logo 28×28 + "Tally", gap 10. Logo = four vertical ink lines and one diagonal green (`--live`) strike, stroke 2.4, round caps. Draw as inline SVG:
   `<path d="M6 5V23M11.5 5V23M17 5V23M22.5 5V23" stroke="#13232B" stroke-width="2.4" stroke-linecap="round"/><path d="M3 20L26 8" stroke="#0E7C66" stroke-width="2.4" stroke-linecap="round"/>` in a 28×28 viewBox.
2. **Search field**: full width, `--sheet`, 1px `--grid` border, radius 8, padding `12px 14px`, gap 10, search icon 18px `--slate`, placeholder "Search the store by name" in `--muted` 14px. **Focus:** 2px `--live` border.
3. **Tracking header**: "Tracking" (Bricolage 17) on the left, "4 of 15 slots" (13px `--slate`) on the right. The right text is `tracked count` of `MAX_TRACKED` from the backend.
4. **Tracked list**: vertical gap 4. One row per tracked product (see 3.1).
5. **Spacer** (grows).
6. **Backend status** at the bottom (see 3.2).

### Main, top to bottom
1. **Product header**: title row (title left, actions right) and a meta row under it (category, then store ID, gap 20, 14px `--slate`).
2. **Current price block**: big price, then one sentence (see 3.4).
3. **Chart section** (see 4).
4. **Scrape log section** (see 5).

---

## 3. Components

### 3.1 Tracked product row
Padding `12px 14px`, radius 8, vertical gap 6. Selected row has `--sheet` background; others transparent.
- Line 1 (space-between): product name (Plex 500, 14) and latest price (Plex 600, 14). If the last scrape failed, show the **last known good price** in `--slate`.
- Line 2 (space-between): status (8px dot + 12px `--slate` text) and a **sparkline** 64×18, 1.5px stroke, round joins; `--ink` when selected, `--muted` otherwise. Sparkline uses real observations from the last 7 days. If fewer than 2 observations exist, hide it.
- Status variants: in stock = `--live` dot "In stock"; low stock = `--amber` dot "Low stock, N left"; out of stock = `--muted` dot "Out of stock"; last attempt failed = `--red` dot "Last scrape failed"; no observation yet = `--muted` dot "First check pending".

### 3.2 Backend status block
Top border 1px `--grid`, padding-top 16, vertical gap 6.
- Line 1: 8px dot + "Backend healthy" (Plex 500, 13). Dot `--live`.
- "Last run 42 minutes ago" and "Next run in 1 h 18 min" (13px `--slate`).
- "Scrapes run every 2 hours" (12px `--muted`).
- Data comes from `GET /api/health`. If the API says `stale: true`, change line 1 to a `--red` dot and "No successful run in over 3 hours". If the API is unreachable, `--muted` dot and "Backend not reachable". "Next run" is computed from the 2-hour slot schedule (even UTC hours).

### 3.3 Buttons and segmented controls
- **Outline button** ("Scrape now"): 1px `--ink` border, radius 8, padding `10px 16px`, Plex 500 14. Disabled while a scrape is running or during the server's 60 s cooldown.
- **Text button** ("Stop tracking"): no border, `--slate` text, same size.
- **Segmented control**: container `--paper`, radius 8, padding 3, gap 2. Option padding `6px 12px`, radius 6, Plex 500 13. Selected option: `--sheet` background + `--ink` text. Others: `--slate` text.
- Small **Track** button in the dropdown: 1px `--ink` border, radius 6, padding `5px 10px`, Plex 500 12.

### 3.4 Price block
- Big price (Bricolage 52) from the latest **successful** observation.
- Sentence (15px `--slate`), three short parts: price change vs the first observation in the selected range, stock text, last check time. Example shape: "₹1,276 lower than a week ago. In stock, 14 left. Last checked 42 minutes ago."
  - The first part is `--live` when the price is lower, `--red` when higher, `--slate` when unchanged.
  - The range wording follows the selected range ("than yesterday", "than a week ago", "than 30 days ago", "since tracking began").
  - "Last checked" uses the **last successful** observation time. If the newest attempt failed, add a fourth sentence: "The latest check failed; showing the last good price." in `--red`.
- If there are no observations yet: show "No price yet" in the big-price slot and the sentence "The first check is running now." (`--slate`).

---

## 4. Chart section

Header row: left = title "Price, stock and scrape runs" (Bricolage 22) with a 13px `--slate` line under it: "Low ₹X on Sep 17. High ₹Y on Sep 14." (computed from real data in range). Right = two segmented controls: range (`24 hours`, `7 days`, `30 days`, `All`; default 7 days) and view (`Chart`, `Table`).

**Table view** = a simple table of observations (time, price, stock) newest first, same table styling as the log.

### Plot (Chart view), one responsive SVG
Reference size 1024×320 at 1440 wide. Build it as a single React component that reads its width from its container (ResizeObserver) and uses a small linear time scale for x and price scale for y. Layers, bottom to top:

1. **Gridlines**: 5 horizontal lines, 1px `--grid`, from x=88 to the right edge. Y range = nice round bounds around the data (in the sample: 11,000 to 15,000 in steps of 1,000). Y labels: 12px `--slate`, right-aligned 14px left of the plot start (x=74), formatted with currency symbol.
2. **Stock band**: y=226, height 24, radius 3. One rectangle per run of equal stock state; colours in section 1. Slots with no successful observation = dashed outline, no fill. Left label "Stock" (12px `--slate`) at x=0.
3. **Scrape strip**: y=270. One bar per *scheduled slot* per product, 4×14 px, radius 1, centred on the slot's x. Left label "Scrape runs" at x=0.
   - Succeeded on first try: `--live` filled.
   - Succeeded after a retry: `--amber` filled + 3.4px amber dot 4px above the bar.
   - Failed (all attempts used): hollow bar, 1.4px `--red` outline, no fill.
   - Slot with no run recorded (missed tick): no bar (leave empty). Do not invent a bar.
4. **Day ticks**: 5px lines at y=292–297 for each midnight, label "Sep 14" (12px `--slate`) at y=300, centred on the tick.
5. **Hover guide**: dashed vertical line (ink at 35% opacity, dash 3 3) from top of plot to below the strip, plus a 5.5px radius marker (white fill, 2px ink stroke) on the price line.
6. **Price line**: 2px `--ink`, round joins and caps. **Solid** between consecutive successful observations. Where one or more slots have no observation (failed or missed), draw a **dashed** segment (dash 4 5) bridging the gap. Never interpolate silently. End dot: 4.5px radius, solid ink, on the latest point.
7. **Tooltip** (on hover/focus of a slot): background `--ink`, radius 8, padding `12px 14px`, vertical gap 2. Lines: time in IST (12px, `--paper`), price (Bricolage 22, white), stock text (12px, white), outcome text (12px, `--amber-tint`), e.g. "Succeeded on attempt 2 of 4" or "Failed after 4 attempts. Nothing saved." Place it to the left of the guide; flip to the right if it would leave the plot. Keyboard: left/right arrow moves between slots when the plot is focused.

**Legend** under the plot (13px `--slate`, gap 28): swatch + "Succeeded on first try"; swatch + "Succeeded after a retry"; swatch + "Failed, nothing saved"; dashed sample + "Dashed line: no price saved for that check".

### Building the strip from the API
The log endpoint returns **attempts**. Group attempts by `run_id` per product to get one result per slot:
- final attempt `success` with `attempt_number = 1` → first try
- final attempt `success` with `attempt_number > 1` → after a retry
- final attempt `failed` → failed
Ask the backend to include `run_id` and `scheduled_slot` in each log row (add it if missing).

---

## 5. Scrape log section

Header row: title "Scrape log" (Bricolage 22) with 13px `--slate` line "Every attempt is listed, including failures. Times are in IST." Right: segmented filter `All`, `Retried`, `Failed`.

Table (no outer border). Column widths at 1440: Time 190, Outcome 120, Attempt 90, Took 90, "What happened" fills the rest.
- Header row: 12px Plex 500 `--slate`, padding `8px 0`, 1px `--grid` bottom border.
- Body rows: padding `12px 0`, 1px `--grid` bottom border, text 14px `--ink` (tabular numbers), newest first. Show attempts as they happened; several attempts from one run appear as separate rows.
- **Outcome badge**: pill, padding `4px 10px`, gap 6, 7px dot, label Plex 500 12 in `--ink`. Success = `--live-tint` bg + `--live` dot; Retried = `--amber-tint` + `--amber`; Failed = `--red-tint` + `--red`.
- Attempt column: "2 of 4" (attempt number of the max attempts).
- Took: "6.2 s", "2 min 4 s".
- "What happened": for failures/retries the **error code** in Plex 500 `--ink` followed by two spaces and a plain sentence in `--slate` (e.g. `HTTP_5XX  Store returned an error on all 4 tries. Nothing saved.`). For successes, a short plain sentence, e.g. "Saved ₹12,723.00, in stock, 14 left". Never show stack traces. Map error codes to plain sentences in one lookup object in the frontend; unknown codes show the code and the server's message.
- Footer link "Show older attempts" (Plex 500 13, `--slate`) loads the next page (cursor pagination, `before` cursor). Hide it when there is no next page.
- Filters call the API with `outcome=retried|failed` (do not filter only in the browser).

---

## 6. Search and autocomplete (Frame 2)

- Typing in the rail search field opens a dropdown under it, 8px gap, absolutely positioned over the rail: width = field width (272 at reference), background `--sheet`, 1px `--grid`, radius 10, padding 6, row gap 2, the one drop shadow from section 1.
- **Result row**: padding `9px 10px`, radius 6, space-between. Left: product name (14px, matched text in weight 600) and category (12px `--slate`). Right: `✓ Tracking` (green check 14px + "Tracking", 12px Plex 500 `--slate`) if already tracked, otherwise the small **Track** button.
- Hover or keyboard-highlighted row: `--paper` background. Arrow keys move, Enter tracks, Escape closes.
- Footer line inside the dropdown: "Product list refreshed daily" (12px `--muted`, padding `8px 10px 4px`).
- **Behaviour:** debounce 250 ms; cancel the previous request with `AbortController`; ignore stale responses; limit 8 results; call `GET /api/catalog/search?q=&limit=8`.
- **States:** searching ("Searching..."), no results ("No products match 'xyz'"), error (show the API error code and a Retry text button), backend cold start ("Waking up the backend. This can take up to a minute on the free tier.").
- Tracking a product calls `POST /api/tracked`, closes the dropdown, selects the new product and shows the first-check-pending state (3.1).

### Empty state (no product selected)
Main area, left-aligned, padding-top 160, vertical gap 18:
1. A row of 26 small **dashed hollow bars** (4×14, radius 1, 1px dashed `#B4BFBC`, 7px gaps) as a "waiting" motif.
2. Title "Pick a product to watch" (Bricolage 40).
3. Body (16px `--slate`, max width 520): "Search the store on the left. Once you track a product, Tally checks its price and stock every 2 hours and keeps every attempt in a log, including the ones that fail."
4. Hint (13px `--muted`): "The first check runs right after you start tracking."

---

## 7. Data and API mapping (from plan.md)

| UI part | Endpoint |
|---|---|
| Search dropdown | `GET /api/catalog/search?q=&limit=8` |
| Track / stop tracking | `POST /api/tracked`, `DELETE /api/tracked/:id` |
| Rail list, latest price, status | `GET /api/tracked` |
| Chart, table view, sparklines | `GET /api/tracked/:id/history?from=&to=` |
| Scrape log, strip | `GET /api/tracked/:id/log?limit=&before=&outcome=` |
| Scrape now | `POST /api/tracked/:id/scrape` |
| Backend status | `GET /api/health` |

Configuration: only `VITE_API_BASE_URL`. All requests use a small `api.js` wrapper with a timeout, `AbortController` support, and retries for GET requests only (to survive a sleeping free-tier backend).

Every request state needs a visible UI: loading, empty, error (show the API's `error.code`). Failures are never hidden.

---

## 8. Responsive and accessibility (minimum)

- Below 1024px: rail becomes a top bar (wordmark, search, and the tracked list in a horizontally scrolling strip); main keeps a single column with 24px padding.
- Below 720px: the log table becomes stacked rows (time and badge on one line, detail below); chart keeps the same layers but hides y labels except min and max; range control scrolls horizontally.
- Visible keyboard focus everywhere (2px `--live` outline, offset 2px). Colour is never the only signal: badges carry text labels, strip bars differ by shape (filled, dot-topped, hollow).
- Text contrast on tints uses `--ink`, never the coloured dot colour.
- Respect `prefers-reduced-motion`. No decorative animation. The only motion is the dropdown appearing and tooltip following the pointer.

---

## 9. Build order and acceptance checklist

Build in this order and check each item before moving on:
1. Tokens, fonts, layout shell (rail + main), health block wired to `/api/health`.
2. Search + track flow with real API, empty state.
3. Tracked list with real latest price, status, sparkline.
4. Product header and price block with real data (and pending / failed variants).
5. Scrape log table with filter and pagination.
6. Chart (line, stock band, strip, dashed gaps, tooltip), then Table view.
7. Responsive pass and keyboard/focus pass.

Done when:
- [ ] Screens match the PNGs at 1440px wide (spacing, type, colours) using **real data only**.
- [ ] A failed or missing check is visible in three places: strip (hollow red bar), price line (dashed bridge), and log (Failed badge with error code).
- [ ] No sample text from the Figma appears anywhere in the code.
- [ ] Cold-start, error and empty states exist for every request.
- [ ] `docs/frontend-notes.md` lists any choice that was not in this spec.
