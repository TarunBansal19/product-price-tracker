# Frontend Implementation Notes

This document logs design and implementation choices, adaptations, or edge-case handling not explicitly defined in `frontend-spec.md`.

## Step 1: Tokens, Fonts, Layout Shell & Backend Status
- **Fonts**: Loaded Google Fonts for `Bricolage Grotesque` (weights 500, 600) and `IBM Plex Sans` (weights 400, 500, 600) in `index.html`.
- **Backend Status Next Run calculation**: Calculated next 2-hour slot time based on even UTC hours (0:00, 2:00, ..., 22:00 UTC) with live interval refresh every minute.
- **Backend Health Polling**: The health status block queries `GET /api/health` on mount and every 30 seconds to provide live status reflection without page refresh.
- **Backend Health Optimization**: In `backend/src/db/repo.js`, parallelized the 3 Supabase health queries using `Promise.all` so response times stay well below the 2000ms health check timeout.
