/**
 * runner/retry.js - Hard timeouts, jittered exponential backoff, and abortable sleep.
 */

import { ScrapeError, ERROR_CODES } from '../store/errors.js';

/**
 * Wraps a promise with a hard timeout and abort controller.
 * If the promise hangs or never settles, rejects with ATTEMPT_TIMEOUT.
 */
export async function withTimeout(promiseOrFn, timeoutMs, { signal, label = 'operation' } = {}) {
  let timer = null;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new ScrapeError(ERROR_CODES.ATTEMPT_TIMEOUT, `${label} timed out after ${timeoutMs}ms`, {
        timeoutMs,
        label
      }));
    }, timeoutMs);
  });

  const abortPromise = signal
    ? new Promise((_, reject) => {
        if (signal.aborted) {
          reject(new ScrapeError(ERROR_CODES.INTERRUPTED, `${label} aborted by signal`));
        }
        signal.addEventListener('abort', () => {
          reject(new ScrapeError(ERROR_CODES.INTERRUPTED, `${label} aborted by signal`));
        });
      })
    : null;

  try {
    const promise = typeof promiseOrFn === 'function' ? promiseOrFn() : promiseOrFn;
    const racers = [promise, timeoutPromise];
    if (abortPromise) racers.push(abortPromise);

    return await Promise.race(racers);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Calculates exponential backoff with ±30% jitter.
 * Honors Retry-After header if provided.
 */
export function calculateBackoff(attemptNo, { baseMs = 1500, maxMs = 15000, retryAfter = null } = {}) {
  if (retryAfter !== null && retryAfter !== undefined) {
    const parsedSec = Number(retryAfter);
    if (!isNaN(parsedSec) && parsedSec > 0) {
      return Math.min(parsedSec * 1000, maxMs);
    }
    const parsedDate = Date.parse(retryAfter);
    if (!isNaN(parsedDate)) {
      const diff = parsedDate - Date.now();
      if (diff > 0) return Math.min(diff, maxMs);
    }
  }

  // baseMs * 2^(attempt - 1)
  const exp = Math.max(0, attemptNo - 1);
  const rawBackoff = Math.min(baseMs * Math.pow(2, exp), maxMs);

  // ±30% jitter: range [0.7 * rawBackoff, 1.3 * rawBackoff]
  const jitterFactor = 0.7 + Math.random() * 0.6;
  const jittered = Math.round(rawBackoff * jitterFactor);

  return Math.min(jittered, maxMs);
}

/**
 * Abortable sleep.
 */
export function sleep(ms, signal = null) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      return reject(new ScrapeError(ERROR_CODES.INTERRUPTED, 'Sleep aborted'));
    }

    const timer = setTimeout(() => {
      resolve();
    }, ms);

    if (signal) {
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          reject(new ScrapeError(ERROR_CODES.INTERRUPTED, 'Sleep aborted'));
        },
        { once: true }
      );
    }
  });
}
