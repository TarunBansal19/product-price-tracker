/**
 * runner/jobRunner.js - Per-product retry loop and attempt lifecycle per §8.5 & §8.7.
 */

import { scrapeProductPrice } from '../store/priceScraper.js';
import { calculateBackoff, sleep } from './retry.js';
import { repo } from '../db/repo.js';
import { isDbConfigured } from '../db/client.js';
import { ScrapeError, ERROR_CODES } from '../store/errors.js';
import { config } from '../config.js';

const SCRAPER_VERSION = '1.0.0';

/**
 * Executes a resilient scrape job for a single product with retry loop and atomic persistence.
 */
export async function executeProductJob({
  product,
  runId = null,
  browser,
  signal = null,
  startAttempt = 1,
  maxAttempts = config.MAX_ATTEMPTS,
  jobDeadlineMs = config.JOB_DEADLINE_MS,
  persist = true,
  injectFault = null,
  onNarrative = null
}) {
  const productId = product.store_product_id || product.id || String(product);
  const trackedProductId = product.id || null;
  const jobStartTime = Date.now();

  const logNarrative = (msg) => {
    if (onNarrative) onNarrative(msg);
  };

  logNarrative(`starting scrape job for product ${productId} (attempts ${startAttempt} to ${maxAttempts})`);

  let lastError = null;
  let finalObservation = null;

  for (let attempt = startAttempt; attempt <= maxAttempts; attempt++) {
    const attemptStart = Date.now();

    // Check job deadline
    if (Date.now() - jobStartTime >= jobDeadlineMs) {
      logNarrative(`job deadline (${jobDeadlineMs}ms) exceeded for product ${productId}`);
      lastError = new ScrapeError(ERROR_CODES.ATTEMPT_TIMEOUT, `Job deadline exceeded`);
      break;
    }

    if (signal?.aborted) {
      logNarrative(`scrape job aborted for product ${productId}`);
      lastError = new ScrapeError(ERROR_CODES.INTERRUPTED, 'Run aborted');
      break;
    }

    // 1. Begin attempt in DB if persisting
    let attemptId = null;
    if (persist && isDbConfigured() && runId && trackedProductId) {
      try {
        attemptId = await repo.beginAttempt({
          runId,
          trackedProductId,
          attemptNumber: attempt,
          strategy: 'browser',
          scraperVersion: SCRAPER_VERSION
        });
      } catch (dbErr) {
        console.warn(`[jobRunner] Failed to begin attempt row: ${dbErr.message}`);
      }
    }

    logNarrative(`product ${productId} attempt ${attempt}/${maxAttempts} → executing scraper...`);

    try {
      // Execute attempt
      const observation = await scrapeProductPrice({
        productId,
        browser,
        signal,
        timeoutMs: config.ATTEMPT_TIMEOUT_MS,
        injectFault: attempt === 1 ? injectFault : null, // only inject on first attempt for demo
        onProgress: logNarrative
      });

      // Attempt Succeeded!
      finalObservation = observation;
      logNarrative(`product ${productId} attempt ${attempt}/${maxAttempts} → SUCCESS: ₹${observation.priceMinor / 100n} (${observation.stockState})`);

      if (persist && isDbConfigured() && attemptId) {
        try {
          await repo.finishAttemptSuccess({
            attemptId,
            observation: {
              ...observation,
              price_minor: observation.priceMinor.toString(),
              list_price_minor: observation.listPriceMinor ? observation.listPriceMinor.toString() : null
            }
          });
        } catch (dbErr) {
          console.error(`[jobRunner] CRITICAL: DB write failed for successful attempt:`, dbErr.message);
          console.log(JSON.stringify({ event: 'PERSIST_FALLBACK_STDOUT', attemptId, observation }, (_, v) => typeof v === 'bigint' ? v.toString() : v));
        }
      }

      return {
        success: true,
        attemptsCount: attempt,
        observation,
        error: null
      };
    } catch (err) {
      const isRetryable = err instanceof ScrapeError ? err.retryable : true;
      const errorCode = err.code || ERROR_CODES.ATTEMPT_TIMEOUT;
      const willRetry = isRetryable && attempt < maxAttempts && (Date.now() - jobStartTime < jobDeadlineMs);
      const outcome = willRetry ? 'retried' : 'failed';

      lastError = err;
      logNarrative(`product ${productId} attempt ${attempt}/${maxAttempts} → ${errorCode}: ${err.message}`);

      // Persist failure/retry row
      if (persist && isDbConfigured() && attemptId) {
        try {
          await repo.finishAttemptFailed({
            attemptId,
            outcome,
            errorCode,
            errorMessage: err.message,
            httpStatus: err.httpStatus || null,
            debug: err.details?.debug || null
          });
        } catch (dbErr) {
          console.warn(`[jobRunner] Failed to record failed attempt in DB: ${dbErr.message}`);
        }
      }

      if (!willRetry) {
        logNarrative(`product ${productId} attempt budget exhausted or fatal error. Final outcome: FAILED.`);
        break;
      }

      const backoffMs = calculateBackoff(attempt, {
        baseMs: config.BACKOFF_BASE_MS,
        maxMs: config.BACKOFF_MAX_MS,
        retryAfter: err.details?.retryAfter
      });

      logNarrative(`waiting ${(backoffMs / 1000).toFixed(1)}s backoff before retry...`);
      await sleep(backoffMs, signal);
    }
  }

  return {
    success: false,
    attemptsCount: maxAttempts,
    observation: null,
    error: lastError
  };
}
