#!/usr/bin/env node
/**
 * cli/recon.js - Phase 0 Reconnaissance Script
 * Records full HAR, XHR/fetch requests, console logs, screenshots, DOM dumps,
 * and computed styles for candidate elements.
 */

import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RECON_DIR = path.resolve(__dirname, '../../../recon-output');

// Parse CLI args
const args = process.argv.slice(2);
function getArg(flag, defaultValue) {
  const idx = args.indexOf(flag);
  if (idx !== -1 && idx + 1 < args.length) return args[idx + 1];
  return defaultValue;
}

const productId = getArg('--id', '200');
const isHeadless = args.includes('--headless') || !process.env.DISPLAY;
const storeOrigin = process.env.STORE_ORIGIN || 'https://demo.inelabteamdev.com';

async function main() {
  await fs.mkdir(RECON_DIR, { recursive: true });
  console.log(`[recon] Target product: ${productId}`);
  console.log(`[recon] Store origin: ${storeOrigin}`);
  console.log(`[recon] Headless: ${isHeadless}`);

  const harPath = path.join(RECON_DIR, `network-${productId}.har`);
  const networkLog = [];
  const consoleLogs = [];
  const pageErrors = [];

  const browser = await chromium.launch({
    headless: isHeadless,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
  });

  const context = await browser.newContext({
    recordHar: {
      path: harPath,
      mode: 'full'
    },
    viewport: { width: 1280, height: 800 }
  });

  const page = await context.newPage();

  // Capture console logs
  page.on('console', msg => {
    consoleLogs.push({
      type: msg.type(),
      text: msg.text(),
      location: msg.location(),
      timestamp: Date.now()
    });
  });

  page.on('pageerror', err => {
    pageErrors.push({
      message: err.message,
      stack: err.stack,
      timestamp: Date.now()
    });
  });

  // Intercept and record all network requests & responses
  page.on('request', req => {
    networkLog.push({
      event: 'request',
      url: req.url(),
      method: req.method(),
      resourceType: req.resourceType(),
      headers: req.headers(),
      postData: req.postData(),
      timestamp: Date.now()
    });
  });

  page.on('response', async res => {
    let bodySample = null;
    try {
      const contentType = res.headers()['content-type'] || '';
      if (contentType.includes('json') || contentType.includes('text')) {
        const text = await res.text();
        bodySample = text.length > 2000 ? text.slice(0, 2000) + '...[truncated]' : text;
      }
    } catch {
      // Body may not be available for aborted or streaming responses
    }

    networkLog.push({
      event: 'response',
      url: res.url(),
      status: res.status(),
      statusText: res.statusText(),
      headers: res.headers(),
      bodySample,
      timestamp: Date.now()
    });
  });

  const targetUrl = `${storeOrigin}/product/${productId}`;
  console.log(`[recon] Navigating to ${targetUrl}...`);
  const startTime = Date.now();
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });

  // Helper to dump DOM and candidate element styles
  async function inspectPage(label) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[recon] Inspecting at ${label} (t=${elapsed}s)...`);

    // Screenshot
    await page.screenshot({
      path: path.join(RECON_DIR, `screenshot-${productId}-${label}.png`),
      fullPage: true
    });

    // Full DOM HTML
    const html = await page.content();
    await fs.writeFile(path.join(RECON_DIR, `dom-${productId}-${label}.html`), html, 'utf-8');

    // Evaluate candidate elements for price and stock
    const candidates = await page.evaluate(() => {
      const results = [];
      // Look for any elements containing currency symbols or digits or keywords
      const allEls = Array.from(document.querySelectorAll('body *'));
      for (const el of allEls) {
        const text = (el.innerText || '').trim();
        const hasPriceCue = /₹|Rs|\$|€|Paise|price|mrp|discount|off/i.test(text);
        const hasStockCue = /stock|left|hurry|available|selling/i.test(text);

        if ((hasPriceCue || hasStockCue) && el.children.length <= 3 && text.length < 150) {
          const style = window.getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          results.push({
            tagName: el.tagName,
            className: el.className,
            id: el.id,
            role: el.getAttribute('role'),
            ariaLabel: el.getAttribute('aria-label'),
            text,
            computedStyle: {
              display: style.display,
              visibility: style.visibility,
              opacity: style.opacity,
              textDecoration: style.textDecoration,
              fontSize: style.fontSize,
              fontWeight: style.fontWeight,
              color: style.color,
              position: style.position
            },
            rect: {
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height
            }
          });
        }
      }
      return results;
    });

    await fs.writeFile(
      path.join(RECON_DIR, `candidates-${productId}-${label}.json`),
      JSON.stringify(candidates, null, 2),
      'utf-8'
    );
  }

  // Helper to dismiss cookie banner if present
  async function dismissCookieBanner() {
    try {
      const overlay = await page.$('.cookie-overlay');
      if (overlay) {
        console.log('[recon] Detected cookie overlay. Dismissing...');
        // May require up to 3 clicks according to client code Jr()
        for (let i = 0; i < 5; i++) {
          const btn = await page.$('.cookie-overlay button.btn-primary, button[aria-label="Accept cookies"]');
          if (btn) {
            await btn.click().catch(() => {});
            await page.waitForTimeout(200);
          }
          const stillThere = await page.$('.cookie-overlay');
          if (!stillThere) {
            console.log(`[recon] Cookie overlay dismissed after ${i + 1} clicks.`);
            break;
          }
        }
      }
    } catch (e) {
      console.log('[recon] Error dismissing cookie banner:', e.message);
    }
  }

  // t = 0s (immediately after domcontentloaded)
  await dismissCookieBanner();
  await inspectPage('t0');

  // t = 1s
  await page.waitForTimeout(1000);
  await dismissCookieBanner();
  await inspectPage('t1');

  // Now trigger the interaction if "Reveal price" button is present or hover is required
  console.log('[recon] Checking for price reveal button / hover area...');
  await dismissCookieBanner();

  const priceBlock = await page.$('.price-block, [class*="price-idle"], [class*="price-block"]');
  if (priceBlock) {
    console.log('[recon] Hovering over price block to trigger telemetry...');
    const box = await priceBlock.boundingBox();
    if (box) {
      // Simulate realistic mouse movements to satisfy minMoves: 8, minDwellMs: 600
      for (let i = 0; i < 15; i++) {
        await dismissCookieBanner();
        await page.mouse.move(box.x + 10 + i * 5, box.y + 10 + (i % 3) * 5);
        await page.waitForTimeout(70);
      }
    }
  }

  // Wait for dwell time
  await page.waitForTimeout(750);
  await dismissCookieBanner();

  // Check if "Reveal price" button is enabled and click it
  const revealBtn = await page.$('button[aria-label="Reveal price"], button:has-text("Reveal price")');
  if (revealBtn) {
    let isDisabled = await revealBtn.isDisabled();
    console.log(`[recon] Reveal price button found. Disabled: ${isDisabled}`);
    if (isDisabled) {
      console.log('[recon] Moving mouse further to satisfy telemetry...');
      for (let i = 0; i < 20; i++) {
        await page.mouse.move(250 + i * 8, 320 + (i % 4) * 8);
        await page.waitForTimeout(60);
      }
      await page.waitForTimeout(700);
      isDisabled = await revealBtn.isDisabled();
      console.log(`[recon] After extra moves: disabled=${isDisabled}`);
    }

    if (!isDisabled) {
      await dismissCookieBanner();
      console.log('[recon] Clicking Reveal price button...');
      await revealBtn.click();
    }
  }

  // Wait for price quote / state change
  console.log('[recon] Waiting for price to hydrate / network response...');
  try {
    await page.waitForResponse(
      res => res.url().includes('/prices') || res.url().includes('/quote') || res.url().includes('/api/'),
      { timeout: 10000 }
    ).catch(() => {});
  } catch {}

  // t = 3s
  await page.waitForTimeout(2000);
  await dismissCookieBanner();
  await inspectPage('t3');

  // t = 10s (allow full hydration / settle)
  await page.waitForTimeout(7000);
  await dismissCookieBanner();
  await inspectPage('t10');

  // Save network and console logs
  await fs.writeFile(
    path.join(RECON_DIR, `network-${productId}.json`),
    JSON.stringify(networkLog, null, 2),
    'utf-8'
  );
  await fs.writeFile(
    path.join(RECON_DIR, `console-${productId}.json`),
    JSON.stringify(consoleLogs, null, 2),
    'utf-8'
  );
  await fs.writeFile(
    path.join(RECON_DIR, `errors-${productId}.json`),
    JSON.stringify(pageErrors, null, 2),
    'utf-8'
  );

  await context.close();
  await browser.close();

  console.log(`[recon] Done! Recon output written to ${RECON_DIR}`);
}

main().catch(err => {
  console.error('[recon] Fatal error:', err);
  process.exit(1);
});
