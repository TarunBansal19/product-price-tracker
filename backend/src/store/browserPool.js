/**
 * store/browserPool.js - Playwright browser lifecycle manager per plan §8.9.
 * Provides lazy launch, crash recovery, memory bounding, and strict origin route guards.
 */

import { chromium } from 'playwright';
import { config } from '../config.js';
import { ALLOWED_ORIGIN } from './urls.js';
import { ScrapeError, ERROR_CODES } from './errors.js';

let browserInstance = null;
let attemptsSinceLaunch = 0;
const MAX_ATTEMPTS_BEFORE_RECYCLE = 50;

/**
 * Returns the singleton browser instance, launching or relaunching if needed.
 */
export async function getBrowser({ headed = false, slowMo = 0 } = {}) {
  if (browserInstance && browserInstance.isConnected()) {
    if (attemptsSinceLaunch >= MAX_ATTEMPTS_BEFORE_RECYCLE) {
      console.log(`[browserPool] Recycling browser after ${attemptsSinceLaunch} attempts to bound RAM.`);
      await closeBrowser();
    } else {
      return browserInstance;
    }
  }

  const isHeadless = headed ? false : (!config.HEADED && !process.env.HEADED);
  const slowMoMs = slowMo || config.SLOW_MO_MS || 0;

  browserInstance = await chromium.launch({
    headless: isHeadless,
    slowMo: slowMoMs,
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-extensions'
    ]
  });

  attemptsSinceLaunch = 0;

  browserInstance.on('disconnected', () => {
    console.warn('[browserPool] Browser disconnected/crashed. Resetting instance.');
    browserInstance = null;
  });

  return browserInstance;
}

let cachedTimeOffset = null;
let lastOffsetFetch = 0;

/**
 * Computes delta between local system time and store server time.
 * Prevents clock-drift or local timezone drift from failing session challenge attestation.
 */
export async function getStoreTimeOffset() {
  const now = Date.now();
  if (cachedTimeOffset !== null && now - lastOffsetFetch < 300000) {
    return cachedTimeOffset;
  }
  try {
    const res = await fetch(`${ALLOWED_ORIGIN}/api/challenge`);
    if (res.ok) {
      const data = await res.json();
      if (data.ts) {
        cachedTimeOffset = data.ts - Date.now();
        lastOffsetFetch = Date.now();
        return cachedTimeOffset;
      }
    }
  } catch (err) {
    console.warn('[browserPool] Failed to sync store server time offset:', err.message);
  }
  return cachedTimeOffset || 0;
}

/**
 * Creates an isolated, clean BrowserContext per attempt.
 * Enforces route blocking for non-store origins to prevent SSRF and bound network.
 */
export async function createAttemptContext(browser, { timeoutMs = 30000, injectFault = null } = {}) {
  attemptsSinceLaunch++;

  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    locale: 'en-IN',
    timezoneId: 'Asia/Kolkata'
  });

  // Global route guard: intercept all traffic
  await context.route('**/*', async (route, request) => {
    const url = request.url();

    // Injected fault simulation for CLI demonstration (only if requested)
    if (injectFault && (url.includes('/prices') || url.includes('/price'))) {
      if (injectFault === 'hang') {
        console.log('[INJECTED FAULT] Simulating hang on price endpoint');
        // Do not respond; let withTimeout handle it
        return;
      }
      if (injectFault === 'http500') {
        console.log('[INJECTED FAULT] Simulating HTTP 500 error');
        return route.fulfill({ status: 500, body: 'Internal Server Error' });
      }
      if (injectFault === 'slow') {
        console.log('[INJECTED FAULT] Simulating slow price response (delaying 5s)');
        await new Promise(r => setTimeout(r, 5000));
      }
      if (injectFault === 'abort') {
        console.log('[INJECTED FAULT] Simulating network abort');
        return route.abort('failed');
      }
    }

    // SSRF Guard: only allow requests to store origin
    try {
      const parsed = new URL(url);
      if (parsed.origin !== ALLOWED_ORIGIN && !url.startsWith('data:') && !url.startsWith('blob:')) {
        // Block external tracking or third-party connections
        return route.abort('blockedbyclient');
      }
    } catch {
      return route.abort('blockedbyclient');
    }

    // Block heavy media to conserve memory (images, media, fonts)
    const resourceType = request.resourceType();
    if (['image', 'media', 'font'].includes(resourceType)) {
      return route.abort('blockedbyclient');
    }

    return route.continue();
  });

  // Inject clock sync and hook into window to capture decrypted authoritative quotes
  const timeOffset = await getStoreTimeOffset();
  await context.addInitScript(`
    (() => {
      const offset = ${timeOffset};
      if (offset !== 0) {
        const origNow = Date.now;
        Date.now = function() {
          return origNow.call(Date) + offset;
        };
      }
      window.__quotes = [];
      const origParse = JSON.parse;
      JSON.parse = function(...args) {
        const result = origParse.apply(this, args);
        if (result && typeof result === 'object' && 'p' in result && 's' in result && 'c' in result) {
          window.__quotes.push(result);
        }
        return result;
      };
    })();
  `);

  return context;
}

/**
 * Safely closes a context with a timeout so closing never hangs.
 */
export async function closeAttemptContext(context, timeoutMs = 3000) {
  if (!context) return;
  try {
    const closePromise = context.close();
    const timer = new Promise((_, reject) => setTimeout(() => reject(new Error('context.close timeout')), timeoutMs));
    await Promise.race([closePromise, timer]);
  } catch (err) {
    console.warn('[browserPool] Failed or timed out closing context:', err.message);
    if (browserInstance) {
      // Force recycle browser if context is stuck
      await closeBrowser().catch(() => {});
    }
  }
}

/**
 * Closes the browser instance gracefully.
 */
export async function closeBrowser() {
  if (browserInstance) {
    try {
      await browserInstance.close();
    } catch {}
    browserInstance = null;
  }
}
