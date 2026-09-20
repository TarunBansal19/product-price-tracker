#!/usr/bin/env node
/**
 * cli/update-baseline.js - Regenerates structure-baseline.json from captured real fixtures.
 * Run deliberately when store changes are reviewed and approved: `npm run baseline:update`.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeFingerprint, compareFingerprints, FINGERPRINT_VERSION } from '../store/structureFingerprint.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURES_DIR = path.resolve(__dirname, '../../test/fixtures/real');
const BASELINE_FILE = path.resolve(__dirname, '../../test/fixtures/structure-baseline.json');

async function main() {
  console.log('[baseline] Scanning real fixtures in:', FIXTURES_DIR);
  const files = (await fs.readdir(FIXTURES_DIR)).filter(f => f.endsWith('.json'));

  if (files.length === 0) {
    throw new Error('No fixture files found in ' + FIXTURES_DIR);
  }

  let baseFingerprint = null;
  const knownQuoteKeys = new Set();
  const knownPriceApiKeys = new Set();
  let validLayoutCount = 0;

  for (const file of files) {
    const filePath = path.join(FIXTURES_DIR, file);
    const content = JSON.parse(await fs.readFile(filePath, 'utf-8'));

    const fp = computeFingerprint({
      rawLayoutJson: content.rawLayoutJson,
      authoritativeQuote: content.authoritativeQuote,
      dom: content.dom,
      rawPriceResponse: content.rawPriceResponse,
      rawProductJson: content.rawProductJson
    });

    if (content.rawLayoutJson) {
      validLayoutCount++;
      if (!baseFingerprint) {
        baseFingerprint = fp;
      }
    }

    if (content.authoritativeQuote) {
      Object.keys(content.authoritativeQuote).forEach(k => knownQuoteKeys.add(k));
    }
    if (content.rawPriceResponse) {
      Object.keys(content.rawPriceResponse).forEach(k => knownPriceApiKeys.add(k));
    }
  }

  if (!baseFingerprint) {
    throw new Error('None of the fixtures contained a valid rawLayoutJson');
  }

  const baseline = {
    generatedAt: new Date().toISOString(),
    fingerprintVersion: FINGERPRINT_VERSION,
    fixturesAnalyzed: files.length,
    validLayoutFixtures: validLayoutCount,
    stableFingerprint: {
      hash: baseFingerprint.hash,
      layoutRevision: baseFingerprint.layoutRevision,
      layoutVariant: baseFingerprint.layoutVariant,
      layoutKeys: baseFingerprint.layoutKeys,
      productApiKeys: baseFingerprint.productApiKeys,
      domKeys: baseFingerprint.domKeys
    },
    knownQuoteKeys: [...knownQuoteKeys].sort(),
    coreQuoteKeys: ['c', 'p', 's', 't'],
    knownPriceApiKeys: [...knownPriceApiKeys].sort()
  };

  // Check if existing baseline exists to show diff
  try {
    const existing = JSON.parse(await fs.readFile(BASELINE_FILE, 'utf-8'));
    const comparison = compareFingerprints(baseFingerprint, existing);
    if (!comparison.match) {
      console.log('[baseline] Detected diffs against previous baseline:');
      console.log(JSON.stringify(comparison.diffs, null, 2));
    } else {
      console.log('[baseline] Previous baseline matches current fixtures cleanly.');
    }
  } catch {
    console.log('[baseline] No previous baseline found; creating fresh baseline.');
  }

  await fs.writeFile(BASELINE_FILE, JSON.stringify(baseline, null, 2), 'utf-8');
  console.log(`[baseline] Successfully written baseline to ${BASELINE_FILE}`);
  console.log(`[baseline] Layout revision: ${baseline.stableFingerprint.layoutRevision}, variant: ${baseline.stableFingerprint.layoutVariant}`);
  console.log(`[baseline] Stable Hash: ${baseline.stableFingerprint.hash}`);
}

main().catch(err => {
  console.error('[baseline] Failed to update baseline:', err);
  process.exit(1);
});
