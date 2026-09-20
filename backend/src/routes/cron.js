/**
 * routes/cron.js - Idempotent 2-hour cron tick handler per plan §9.1.
 */

import express from 'express';
import { requireCronAuth } from '../middleware/auth.js';
import { repo } from '../db/repo.js';
import { runScrape, isRunInProgress } from '../runner/runScrape.js';

export const cronRouter = express.Router();

/**
 * Computes canonical 2-hour slot in UTC with a 15-minute forward window.
 * slot = floor((now + 15 min) / 2 h) * 2 h
 */
export function computeCronSlot(date = new Date()) {
  const FIFTEEN_MINS_MS = 15 * 60 * 1000;
  const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

  const shifted = date.getTime() + FIFTEEN_MINS_MS;
  const slotMs = Math.floor(shifted / TWO_HOURS_MS) * TWO_HOURS_MS;
  return new Date(slotMs);
}

cronRouter.post('/tick', requireCronAuth, async (req, res, next) => {
  try {
    const slot = computeCronSlot();

    // Check if another run is already actively executing in this Node process
    if (isRunInProgress()) {
      return res.status(200).json({
        status: 'skipped',
        reason: 'run_in_progress',
        slot: slot.toISOString()
      });
    }

    // Atomically claim the unique cron slot in Postgres
    const runId = await repo.claimCronRun(slot, 1800);
    if (!runId) {
      // Slot already claimed and handled by an earlier or concurrent tick
      return res.status(200).json({
        status: 'skipped',
        reason: 'slot_already_handled',
        slot: slot.toISOString()
      });
    }

    // Return 202 Accepted immediately so cron-job.org doesn't timeout
    res.status(202).json({
      status: 'accepted',
      runId,
      slot: slot.toISOString(),
      message: 'Scrape run dispatched in background'
    });

    // Execute run asynchronously on the event loop
    setImmediate(async () => {
      try {
        await runScrape(runId, { trigger: 'cron' });
      } catch (err) {
        console.error(`[cron] Background runScrape error:`, err);
      }
    });
  } catch (err) {
    next(err);
  }
});
