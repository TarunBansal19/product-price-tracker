/**
 * runner/runScrape.js - Orchestrates one cron or manual scrape run across tracked products.
 * Handles product leases, run deadlines, circuit breaker, sequential execution, and state repair.
 */

import { repo } from '../db/repo.js';
import { isDbConfigured } from '../db/client.js';
import { getBrowser, closeBrowser } from '../store/browserPool.js';
import { executeProductJob } from './jobRunner.js';
import { CircuitBreaker } from './circuitBreaker.js';
import { ScrapeError, ERROR_CODES } from '../store/errors.js';
import { config } from '../config.js';

let isScrapeRunning = false;

export function isRunInProgress() {
  return isScrapeRunning;
}

/**
 * Runs the full scrape cycle for all active tracked products.
 */
export async function runScrape(runId, { trigger = 'cron' } = {}) {
  if (isScrapeRunning) {
    console.warn(`[runScrape] Scrape run already in progress. Rejecting concurrent trigger.`);
    return { status: 'skipped', reason: 'run_in_progress' };
  }

  isScrapeRunning = true;
  const runStartTime = Date.now();
  console.log(`[runScrape] Starting scrape run ${runId} (trigger: ${trigger})...`);

  if (!isDbConfigured()) {
    console.warn('[runScrape] DB not configured. Skipping run.');
    isScrapeRunning = false;
    return { status: 'skipped', reason: 'db_not_configured' };
  }

  const circuitBreaker = new CircuitBreaker({ threshold: 5, probeCooldownMs: 45000 });
  let browser = null;
  let productsOk = 0;
  let productsFailed = 0;
  let totalProducts = 0;
  let runNote = null;
  let finalStatus = 'completed';

  try {
    // 1. Startup sweep of stale locks / orphaned attempts
    try {
      const sweepRes = await repo.sweepStale();
      console.log(`[runScrape] Stale sweep completed:`, sweepRes);
    } catch (sweepErr) {
      console.warn(`[runScrape] Sweep stale warning: ${sweepErr.message}`);
    }

    // 2. Fetch active tracked products (capped to MAX_TRACKED)
    const trackedList = await repo.getActiveTrackedProducts(config.MAX_TRACKED);
    totalProducts = trackedList.length;

    if (totalProducts === 0) {
      console.log('[runScrape] No active products to scrape.');
      await repo.finishRun({
        runId,
        status: 'completed',
        productsTotal: 0,
        productsOk: 0,
        productsFailed: 0,
        note: 'No active tracked products'
      });
      return { status: 'completed', total: 0, ok: 0, failed: 0 };
    }

    // 3. Acquire Chromium instance
    browser = await getBrowser({ headed: false });

    // 4. Sequential loop over products (CONCURRENCY = 1 for memory and politeness)
    for (let i = 0; i < trackedList.length; i++) {
      const product = trackedList[i];
      const prodId = product.store_product_id;

      // Check Run Deadline
      if (Date.now() - runStartTime >= config.RUN_DEADLINE_MS) {
        console.warn(`[runScrape] Run deadline (${config.RUN_DEADLINE_MS}ms) exceeded. Skipping remaining products.`);
        runNote = 'RUN_DEADLINE_EXCEEDED';
        finalStatus = 'completed_with_failures';

        // Record SKIPPED_RUN_DEADLINE for remaining products honestly
        for (let j = i; j < trackedList.length; j++) {
          const skippedProduct = trackedList[j];
          try {
            const attemptId = await repo.beginAttempt({
              runId,
              trackedProductId: skippedProduct.id,
              attemptNumber: 1,
              strategy: 'browser',
              scraperVersion: '1.0.0'
            });
            await repo.finishAttemptFailed({
              attemptId,
              outcome: 'failed',
              errorCode: ERROR_CODES.SKIPPED_RUN_DEADLINE,
              errorMessage: 'Skipped because overall scrape run deadline was exceeded'
            });
          } catch {}
          productsFailed++;
        }
        break;
      }

      // Check Circuit Breaker
      if (!circuitBreaker.canExecute()) {
        console.warn(`[runScrape] Circuit breaker OPEN. Aborting remaining products.`);
        runNote = 'CIRCUIT_BREAKER_OPEN';
        finalStatus = 'aborted';

        for (let j = i; j < trackedList.length; j++) {
          const skippedProduct = trackedList[j];
          try {
            const attemptId = await repo.beginAttempt({
              runId,
              trackedProductId: skippedProduct.id,
              attemptNumber: 1,
              strategy: 'browser',
              scraperVersion: '1.0.0'
            });
            await repo.finishAttemptFailed({
              attemptId,
              outcome: 'failed',
              errorCode: ERROR_CODES.SKIPPED_CIRCUIT_OPEN,
              errorMessage: 'Skipped because circuit breaker was tripped by store outages'
            });
          } catch {}
          productsFailed++;
        }
        break;
      }

      // Claim product lock/lease to prevent concurrent scrape of same product
      let hasLease = false;
      try {
        hasLease = await repo.claimProduct(product.id, 120);
      } catch (leaseErr) {
        console.warn(`[runScrape] Failed to claim lease for product ${prodId}: ${leaseErr.message}`);
      }

      if (!hasLease) {
        console.log(`[runScrape] Product ${prodId} currently leased by another job. Skipping.`);
        continue;
      }

      try {
        console.log(`[runScrape] [${i + 1}/${totalProducts}] Processing product ${prodId}...`);
        const jobResult = await executeProductJob({
          product,
          runId,
          browser,
          maxAttempts: config.MAX_ATTEMPTS,
          jobDeadlineMs: config.JOB_DEADLINE_MS,
          persist: true,
          onNarrative: (msg) => console.log(`  ${msg}`)
        });

        if (jobResult.success) {
          productsOk++;
          circuitBreaker.recordSuccess();
        } else {
          productsFailed++;
          circuitBreaker.recordFailure(jobResult.error?.code);
        }
      } catch (jobErr) {
        console.error(`[runScrape] Uncaught error in product ${prodId} job: ${jobErr.message}`);
        productsFailed++;
        circuitBreaker.recordFailure(jobErr.code || ERROR_CODES.ATTEMPT_TIMEOUT);
      } finally {
        // Release product lease
        try {
          await repo.releaseProduct(product.id);
        } catch {}
      }

      // Politeness jitter delay between products: 500ms – 1500ms per §8.5
      const interProductDelay = 500 + Math.floor(Math.random() * 1000);
      await new Promise(r => setTimeout(r, interProductDelay));
    }

    if (finalStatus !== 'aborted') {
      finalStatus = productsFailed === 0 ? 'completed' : productsOk > 0 ? 'completed_with_failures' : 'interrupted';
    }

    await repo.finishRun({
      runId,
      status: finalStatus,
      productsTotal: totalProducts,
      productsOk,
      productsFailed,
      note: runNote
    });

    console.log(`[runScrape] Finished run ${runId}: ${finalStatus} (${productsOk}/${totalProducts} ok, ${productsFailed} failed)`);
    return { status: finalStatus, total: totalProducts, ok: productsOk, failed: productsFailed };
  } catch (fatalErr) {
    console.error(`[runScrape] Fatal error in run ${runId}:`, fatalErr);
    if (runId && isDbConfigured()) {
      await repo.finishRun({
        runId,
        status: 'interrupted',
        productsTotal: totalProducts,
        productsOk,
        productsFailed,
        note: `Fatal error: ${fatalErr.message}`
      }).catch(() => {});
    }
    return { status: 'interrupted', error: fatalErr.message };
  } finally {
    isScrapeRunning = false;
    if (browser) {
      await closeBrowser().catch(() => {});
    }
  }
}
