#!/usr/bin/env node
/**
 * cli/scrape.js - Observable scraper CLI per plan §8.11.
 * Supports headed and headless runs, narrative logging, fault injection, and persistence.
 * Usage:
 *   npm run scrape -- --ids 200,114 [--headed] [--slowmo 250] [--persist] [--inject slow|hang|http500|abort]
 */

import { getBrowser, closeBrowser } from '../store/browserPool.js';
import { executeProductJob } from '../runner/jobRunner.js';
import { config } from '../config.js';
import { isDbConfigured } from '../db/client.js';
import { repo } from '../db/repo.js';

const args = process.argv.slice(2);

function getArg(flag, defaultValue = null) {
  const idx = args.indexOf(flag);
  if (idx !== -1 && idx + 1 < args.length) return args[idx + 1];
  return defaultValue;
}

const hasFlag = (flag) => args.includes(flag);

const idsArg = getArg('--ids', '200');
const productIds = idsArg.split(',').map(s => s.trim()).filter(Boolean);
const isHeaded = hasFlag('--headed') || config.HEADED;
const slowMo = parseInt(getArg('--slowmo', String(config.SLOW_MO_MS || 0)), 10);
const shouldPersist = hasFlag('--persist');
const injectFault = getArg('--inject', null);

if (injectFault && shouldPersist) {
  console.error('[ERROR] Per Operating Rule R2: Injected faults may NEVER be combined with --persist!');
  process.exit(1);
}

async function main() {
  console.log('========================================================');
  console.log('           INE PRODUCT PRICE TRACKER — SCRAPER          ');
  console.log('========================================================');
  console.log(`Target IDs:       ${productIds.join(', ')}`);
  console.log(`Mode:             ${isHeaded ? 'HEADED (Observable)' : 'HEADLESS'}`);
  console.log(`Slow-Mo:          ${slowMo} ms`);
  console.log(`Persistence:      ${shouldPersist ? 'ENABLED (Writing to DB)' : 'DISABLED (--no-persist default)'}`);
  if (injectFault) {
    console.log(`[INJECTED FAULT]: Simulating "${injectFault}" on network boundary`);
  }
  console.log('--------------------------------------------------------\n');

  let runId = null;
  if (shouldPersist && isDbConfigured()) {
    try {
      runId = await repo.claimManualRun('manual', 1200);
      console.log(`[DB] Initialized manual scrape run: ${runId}`);
    } catch (e) {
      console.warn(`[DB] Failed to initialize DB run: ${e.message}`);
    }
  }

  const browser = await getBrowser({ headed: isHeaded, slowMo });
  const results = [];

  try {
    for (const id of productIds) {
      console.log(`\n>>> Processing Product ${id}...`);
      let productToScrape = { id, store_product_id: String(id) };

      if (shouldPersist && isDbConfigured()) {
        try {
          let tracked = await repo.getTrackedProductByStoreId(String(id));
          if (!tracked) {
            let name = `Product ${id}`;
            let category = null;
            try {
              const { items } = await repo.searchCatalog({ query: '', limit: 100 });
              const found = items.find(it => String(it.store_product_id) === String(id));
              if (found) {
                name = found.name;
                category = found.category;
              }
            } catch {}
            tracked = await repo.trackProduct({
              storeProductId: String(id),
              name,
              category
            });
            console.log(`[DB] Auto-tracked product ${id} (UUID: ${tracked.id})`);
          }
          productToScrape = tracked;
        } catch (trackErr) {
          console.warn(`[DB] Could not resolve tracked product: ${trackErr.message}`);
        }
      }

      const res = await executeProductJob({
        product: productToScrape,
        runId,
        browser,
        persist: shouldPersist,
        injectFault,
        onNarrative: (msg) => console.log(`  ${msg}`)
      });

      results.push({ id, ...res });
    }
  } finally {
    await closeBrowser();
  }

  if (runId && isDbConfigured()) {
    const total = results.length;
    const ok = results.filter(r => r.success).length;
    const failed = total - ok;
    await repo.finishRun({
      runId,
      status: failed === 0 ? 'completed' : ok > 0 ? 'completed_with_failures' : 'aborted',
      productsTotal: total,
      productsOk: ok,
      productsFailed: failed,
      note: 'Completed via CLI scrape'
    }).catch(() => {});
  }

  console.log('\n--------------------------------------------------------');
  console.log('                     RUN SUMMARY                        ');
  console.log('--------------------------------------------------------');
  for (const r of results) {
    if (r.success) {
      const p = r.observation;
      console.log(`✔ Product ${r.id}: ₹${p.priceMinor / 100n} | Stock: ${p.stockState} (${p.stockQuantity ?? 'N/A'}) | Cross-checked: ${p.crossChecked} | Attempts: ${r.attemptsCount}`);
    } else {
      console.log(`✗ Product ${r.id}: FAILED after ${r.attemptsCount} attempts (${r.error?.code || 'ERROR'}: ${r.error?.message})`);
    }
  }
  console.log('========================================================\n');
}

main().catch(err => {
  console.error('Fatal CLI Error:', err);
  process.exit(1);
});
