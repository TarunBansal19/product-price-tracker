/**
 * store/priceScraper.js - Scraper strategy implementation per plan §8.
 * Executes the full pipeline with cookie dismissal, telemetry satisfaction,
 * authoritative quote capture, DOM cross-checking, and validation gates.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildProductUrl } from './urls.js';
import { createAttemptContext, closeAttemptContext, getStoreTimeOffset } from './browserPool.js';
import { pickPrice } from './extract/index.js';
import { validationGates } from './validate.js';
import { ScrapeError, ERROR_CODES } from './errors.js';
import { computeFingerprint, compareFingerprints } from './structureFingerprint.js';
import { withTimeout } from '../runner/retry.js';
import { config } from '../config.js';

const SCRAPER_VERSION = '1.0.0';

let cachedBaseline = null;
function getBaseline() {
  if (cachedBaseline) return cachedBaseline;
  try {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const p = path.resolve(__dirname, '../../test/fixtures/structure-baseline.json');
    if (fs.existsSync(p)) {
      cachedBaseline = JSON.parse(fs.readFileSync(p, 'utf-8'));
    }
  } catch {
    // Non-blocking advisory check
  }
  return cachedBaseline;
}

/**
 * Dismisses the chaotic cookie overlay by clicking Accept until removed.
 */
async function dismissCookies(page) {
  let attempts = 0;
  while (attempts < 6) {
    const overlay = await page.$('.cookie-overlay');
    if (!overlay) break;

    const acceptBtn = await page.$('.cookie-overlay button.btn-primary, button[aria-label="Accept cookies"]');
    if (acceptBtn) {
      await acceptBtn.click().catch(() => {});
      await page.waitForTimeout(150);
    } else {
      break;
    }
    attempts++;
  }
}

/**
 * Executes a single scrape attempt for a product ID.
 * Returns a validated RawObservation or throws a typed ScrapeError.
 */
export async function scrapeProductPrice({
  productId,
  browser,
  signal = null,
  timeoutMs = config.ATTEMPT_TIMEOUT_MS,
  injectFault = null,
  onProgress = null
}) {
  const url = buildProductUrl(productId);
  const startTime = Date.now();
  let context = null;
  let stage = 'init';
  let httpStatus = 200;
  let domCandidates = [];
  let rawProductJson = null;
  let rawPriceResponse = null;
  let rawLayoutJson = null;
  let structureDrift = null;

  const notify = (msg) => {
    if (onProgress) onProgress(`[t+${((Date.now() - startTime) / 1000).toFixed(1)}s] product ${productId}: ${msg}`);
  };

  try {
    return await withTimeout(
      async () => {
        stage = 'launch_context';
        context = await createAttemptContext(browser, { timeoutMs, injectFault });
        const page = await context.newPage();

        page.on('response', async res => {
          const resUrl = res.url();
          try {
            if (resUrl.includes(`/api/product/${productId}`)) {
              rawProductJson = await res.json();
            } else if (resUrl.includes(`/api/products/${productId}/price`)) {
              rawPriceResponse = await res.json();
            } else if (resUrl.includes('/api/layout')) {
              rawLayoutJson = await res.json();
            }
          } catch {}
        });

        stage = 'navigate';
        notify(`navigating to ${url}...`);

        let mainNavResponse = null;
        try {
          mainNavResponse = await page.goto(url, {
            waitUntil: 'domcontentloaded',
            timeout: Math.min(timeoutMs, 15000)
          });
        } catch (err) {
          throw new ScrapeError(ERROR_CODES.NAV_TIMEOUT, `Navigation failed: ${err.message}`, { stage });
        }

        if (mainNavResponse) {
          httpStatus = mainNavResponse.status();
          validationGates.checkV1ExpectedContent({ httpStatus, body: 'html', isHtml: true });
        }

        stage = 'dismiss_cookies';
        await dismissCookies(page);

        stage = 'locate_price_block';
        notify('waiting for price container...');
        const priceBlock = await page.waitForSelector('.price-block, [class*="price"]', {
          timeout: 8000
        }).catch(() => null);

        if (!priceBlock) {
          // Check if page showed 404 or missing container
          const pageText = await page.innerText('body').catch(() => '');
          if (/not found|404|doesn't exist/i.test(pageText)) {
            throw new ScrapeError(ERROR_CODES.NOT_FOUND, `Product ${productId} not found on page`, { stage });
          }
          throw new ScrapeError(ERROR_CODES.STRUCTURE_CHANGED, 'Price block container not found in DOM', { stage });
        }

        stage = 'telemetry_interaction';
        notify('satisfying interaction telemetry (hover & dwell)...');
        await priceBlock.scrollIntoViewIfNeeded().catch(() => {});
        const box = await priceBlock.boundingBox();
        if (box) {
          // Dispatch mouse movements to satisfy minMoves: 8 and minDwellMs: 600
          for (let i = 0; i < 18; i++) {
            await dismissCookies(page);
            await page.mouse.move(box.x + 10 + i * 5, box.y + 10 + (i % 3) * 5);
            await page.waitForTimeout(50);
          }
        }
        await page.waitForTimeout(700);
        await dismissCookies(page);

        stage = 'click_reveal';
        const revealBtn = await page.$('button[aria-label="Reveal price"], button:has-text("Reveal price")');
        if (revealBtn) {
          let disabled = await revealBtn.isDisabled().catch(() => true);
          if (disabled) {
            notify('button still disabled, performing additional dwell movements...');
            for (let i = 0; i < 15; i++) {
              await page.mouse.move(250 + i * 8, 300 + (i % 4) * 8);
              await page.waitForTimeout(50);
            }
            await page.waitForTimeout(600);
            disabled = await revealBtn.isDisabled().catch(() => true);
          }

          if (disabled) {
            throw new ScrapeError(ERROR_CODES.GATE_NOT_PASSED, 'Reveal price button remained disabled after telemetry', { stage });
          }

          notify('clicking Reveal price button...');
          await dismissCookies(page);
          await revealBtn.click({ timeout: 5000 }).catch(err => {
            throw new ScrapeError(ERROR_CODES.CLICK_NOT_REGISTERED, `Failed to click reveal button: ${err.message}`, { stage });
          });
        }

        stage = 'wait_for_price';
        notify('waiting for price response and hydration...');
        try {
          await page.waitForFunction(
            () => {
              const quotes = window.__quotes;
              const block = document.querySelector('.price-block');
              if (!block) return false;
              const isBusy = block.getAttribute('aria-busy') === 'true' || Boolean(block.querySelector('.spinner'));
              const text = block.innerText || '';
              if (isBusy || /loading|checking|updating|price hidden/i.test(text)) return false;
              if (quotes && quotes.length > 0) return true;
              return /₹|Rs|\$|€/.test(text);
            },
            null,
            { timeout: 25000 }
          );
          await page.waitForTimeout(350);
        } catch (waitErr) {
          // Determine if error state is displayed in UI
          const isErrorState = await page.$('.price-error, [class*="error"]').catch(() => null);
          if (isErrorState) {
            const errText = await isErrorState.innerText().catch(() => '');
            throw new ScrapeError(ERROR_CODES.GATE_NOT_PASSED, `Store showed error: "${errText}"`, { stage });
          }
          throw new ScrapeError(ERROR_CODES.CONTENT_NOT_READY, `Price hydration timed out: ${waitErr.message}`, { stage });
        }

        await dismissCookies(page);
        stage = 'extract';
        notify('extracting price and stock signals...');

        // 1. Intercept authoritative quote object if present
        const quotes = await page.evaluate(() => window.__quotes || []);
        const authoritativeQuote = quotes[quotes.length - 1] || null;

        // 2. Extract DOM candidates from the main price block
        const domData = await page.evaluate(() => {
          const block = document.querySelector('.price-block');
          if (!block) return { candidates: [], blockText: '', isBusy: false };

          const isBusy = block.getAttribute('aria-busy') === 'true' || Boolean(block.querySelector('.spinner'));
          const candidates = [];

          for (const el of block.querySelectorAll('*')) {
            const style = window.getComputedStyle(el);
            const isVisible = style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
            const isStruck = style.textDecoration.includes('line-through');
            const text = (el.innerText || '').trim();

            if (!isVisible || !text || text.length > 120) continue;

            const hasCurrency = /(₹|Rs\.?|\$|€)/i.test(text);
            const isLeaf = el.children.length === 0;
            const isPriceContainer = hasCurrency && Array.from(el.children).every(c => ['SPAN', 'B', 'STRONG', 'I', 'EM'].includes(c.tagName));

            if (isLeaf || isPriceContainer) {
              candidates.push({
                tagName: el.tagName,
                className: el.className,
                text,
                visible: isVisible,
                struckThrough: isStruck
              });
            }
          }

          return {
            candidates,
            blockText: block.innerText || '',
            isBusy
          };
        });

        domCandidates = domData.candidates;

        // Structure Drift Check (non-blocking early warning)
        const baseline = getBaseline();
        if (baseline) {
          try {
            const currentFp = computeFingerprint({
              rawLayoutJson,
              authoritativeQuote,
              dom: domData,
              rawPriceResponse,
              rawProductJson
            });
            const comp = compareFingerprints(currentFp, baseline);
            if (!comp.match) {
              structureDrift = comp.diffs;
              if (comp.hasHighSeverity) {
                notify(`[WARN: STRUCTURE DRIFT] ${comp.diffs.map(d => d.message).join('; ')}`);
              }
            }
          } catch (fpErr) {
            // Non-blocking advisory check
          }
        }

        // V2 Readiness Gate: Ensure no placeholders remaining
        validationGates.checkV2ContentReady({
          rawText: authoritativeQuote ? String(authoritativeQuote.p) : '',
          domText: domData.blockText,
          isBusy: domData.isBusy
        });

        // 3. Selection & Cross-Checking
        const result = pickPrice({
          authoritativeQuote,
          domCandidates: domData.candidates,
          blockText: domData.blockText
        });

        stage = 'validate';
        // V4: Price sanity
        validationGates.checkV4PriceSane({
          priceMinor: result.priceMinor,
          currency: result.currency
        });

        // V8: Stock recognized
        validationGates.checkV8StockRecognized({
          stockState: result.stockState,
          quantity: result.stockQuantity
        });

        // V9: Freshness
        if (authoritativeQuote?.t) {
          const timeOffset = await getStoreTimeOffset();
          validationGates.checkV9Freshness({ quoteTimestamp: authoritativeQuote.t, timeOffset });
        }

        const observedAt = authoritativeQuote?.t
          ? new Date(authoritativeQuote.t).toISOString()
          : new Date().toISOString();

        notify(`accepted ${result.priceMinor / 100n} ${result.currency} (${result.stockState}, cross_checked=${result.crossChecked})`);

        return {
          observedAt,
          priceMinor: result.priceMinor,
          currency: result.currency,
          stockState: result.stockState,
          stockQuantity: result.stockQuantity,
          listPriceMinor: result.listPriceMinor,
          rawPriceText: result.rawPriceText,
          rawStockText: result.rawStockText,
          priceSource: result.priceSource,
          crossChecked: result.crossChecked,
          structureDrift
        };
      },
      timeoutMs,
      { signal, label: `scrape_attempt_${productId}` }
    );
  } catch (err) {
    // Build debug snapshot per §8.10 (failures only, <= 8 KB)
    const debug = {
      url,
      strategy: 'browser',
      stage,
      httpStatus,
      durationMs: Date.now() - startTime,
      candidates: domCandidates.slice(0, 8),
      scraperVersion: SCRAPER_VERSION,
      structureDrift,
      error: err.message?.slice(0, 300)
    };

    if (err instanceof ScrapeError) {
      err.details.debug = debug;
      throw err;
    }

    throw new ScrapeError(ERROR_CODES.ATTEMPT_TIMEOUT, err.message, {
      debug,
      stage,
      httpStatus
    });
  } finally {
    if (context) {
      await closeAttemptContext(context, 3000);
    }
  }
}
