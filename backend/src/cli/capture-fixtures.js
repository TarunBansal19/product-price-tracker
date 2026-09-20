#!/usr/bin/env node
/**
 * cli/capture-fixtures.js - Capture real responses and DOM from the live store.
 * Saved into backend/test/fixtures/real/ with capture timestamp, URL, and metadata.
 */

import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURES_DIR = path.resolve(__dirname, '../../test/fixtures/real');

const STORE_ORIGIN = process.env.STORE_ORIGIN || 'https://demo.inelabteamdev.com';

// 8 varied products across different categories
const DEFAULT_PRODUCTS = [
  '200', // Peripherals
  '114', // Peripherals
  '10',  // Laptops
  '14',  // Laptops
  '86',  // Audio
  '206', // Power
  '776', // Smart Home
  '50'   // Audio
];

async function captureProduct(browser, productId) {
  console.log(`[capture] Capturing product ${productId}...`);
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 }
  });
  const page = await context.newPage();

  // Inject hook to capture decrypted quotes
  await page.addInitScript(() => {
    window.__quotes = [];
    const orig = JSON.parse;
    JSON.parse = function(...args) {
      const res = orig.apply(this, args);
      if (res && typeof res === 'object' && 'p' in res && 's' in res && 'c' in res) {
        window.__quotes.push(res);
      }
      return res;
    };
  });

  let rawProductJson = null;
  let rawPriceResponse = null;
  let rawLayoutJson = null;

  page.on('response', async res => {
    const url = res.url();
    try {
      if (url.includes(`/api/product/${productId}`)) {
        rawProductJson = await res.json();
      } else if (url.includes(`/api/products/${productId}/price`)) {
        rawPriceResponse = await res.json();
      } else if (url.includes('/api/layout')) {
        rawLayoutJson = await res.json();
      }
    } catch {}
  });

  const url = `${STORE_ORIGIN}/product/${productId}`;
  const startLoad = Date.now();
  await page.goto(url, { waitUntil: 'domcontentloaded' });

  // Dismiss cookie banner if present
  async function dismissCookies() {
    let overlay = await page.$('.cookie-overlay');
    let attempts = 0;
    while (overlay && attempts < 5) {
      attempts++;
      const btn = await page.$('.cookie-overlay button.btn-primary, button[aria-label="Accept cookies"]');
      if (btn) await btn.click().catch(() => {});
      await page.waitForTimeout(200);
      overlay = await page.$('.cookie-overlay');
    }
  }

  await dismissCookies();
  await page.waitForTimeout(600);
  await dismissCookies();

  // Hover over price block
  const block = await page.waitForSelector('.price-block', { timeout: 8000 }).catch(() => null);
  if (!block) {
    throw new Error(`Price block not found for product ${productId}`);
  }

  const box = await block.boundingBox();
  if (box) {
    for (let i = 0; i < 18; i++) {
      await page.mouse.move(box.x + 10 + i * 5, box.y + 10 + (i % 3) * 5);
      await page.waitForTimeout(60);
    }
  }
  await page.waitForTimeout(750);
  await dismissCookies();

  // Click Reveal price button
  const revealBtn = await page.$('button[aria-label="Reveal price"]');
  if (revealBtn && !(await revealBtn.isDisabled())) {
    await dismissCookies();
    await revealBtn.click().catch(() => {});
  } else if (revealBtn) {
    // Need a bit more dwell
    for (let i = 0; i < 15; i++) {
      await page.mouse.move(250 + i * 8, 300 + (i % 4) * 8);
      await page.waitForTimeout(50);
    }
    await page.waitForTimeout(700);
    await dismissCookies();
    if (!(await revealBtn.isDisabled())) {
      await revealBtn.click().catch(() => {});
    }
  }

  // Wait for price resolution
  await page.waitForResponse(
    res => res.url().includes(`/api/products/${productId}/price`),
    { timeout: 15000 }
  ).catch(() => {});

  await page.waitForTimeout(2500);
  await dismissCookies();

  const totalDuration = Date.now() - startLoad;
  const quotes = await page.evaluate(() => window.__quotes || []);
  const authoritativeQuote = quotes[quotes.length - 1] || null;

  // Extract candidate elements and DOM details
  const domDetails = await page.evaluate(() => {
    const blockEl = document.querySelector('.price-block');
    if (!blockEl) return null;

    const candidates = [];
    for (const el of blockEl.querySelectorAll('*')) {
      const text = (el.innerText || '').trim();
      const style = window.getComputedStyle(el);
      const isVisible = style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
      const isStruck = style.textDecoration.includes('line-through');

      if (text.length > 0 && text.length < 100 && el.children.length === 0) {
        candidates.push({
          tagName: el.tagName,
          className: el.className,
          text,
          visible: isVisible,
          struckThrough: isStruck,
          fontSize: style.fontSize,
          color: style.color
        });
      }
    }

    return {
      blockHtml: blockEl.outerHTML,
      blockText: blockEl.innerText,
      candidates
    };
  });

  const capturedAt = new Date().toISOString();
  const fixture = {
    capturedAt,
    url,
    productId,
    durationMs: totalDuration,
    rawProductJson,
    rawPriceResponse,
    rawLayoutJson,
    authoritativeQuote,
    dom: domDetails,
    notes: `Captured live from ${url} on ${capturedAt}`
  };

  const filename = `fixture-${productId}-${Date.now()}.json`;
  const targetPath = path.join(FIXTURES_DIR, filename);
  await fs.writeFile(targetPath, JSON.stringify(fixture, null, 2), 'utf-8');
  console.log(`[capture] Saved fixture to ${filename} (price: ${authoritativeQuote?.p}, stock: ${authoritativeQuote?.s})`);

  await context.close();
  return fixture;
}

async function main() {
  await fs.mkdir(FIXTURES_DIR, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
  });

  try {
    console.log(`[capture] Capturing fixtures for ${DEFAULT_PRODUCTS.length} products...`);
    for (const id of DEFAULT_PRODUCTS) {
      try {
        await captureProduct(browser, id);
        // Small delay between captures
        await new Promise(r => setTimeout(r, 1000));
      } catch (err) {
        console.error(`[capture] Failed to capture product ${id}:`, err.message);
      }
    }

    console.log('[capture] Running round 2 for varied timestamps...');
    // Round 2 capture for at least 4 products to test price cadence and variation
    for (const id of DEFAULT_PRODUCTS.slice(0, 4)) {
      try {
        await captureProduct(browser, id);
        await new Promise(r => setTimeout(r, 1000));
      } catch (err) {
        console.error(`[capture] Round 2 failed for product ${id}:`, err.message);
      }
    }
  } finally {
    await browser.close();
  }
}

main().catch(err => {
  console.error('[capture] Fatal error:', err);
  process.exit(1);
});
