/**
 * store/structureFingerprint.js - Page and payload structure fingerprinting.
 * Provides deterministic fingerprint computation and drift comparison.
 * Detects layout revisions, missing/added keys, and schema drift before extraction silently fails.
 */

import { createHash } from 'node:crypto';

export const FINGERPRINT_VERSION = 1;

/**
 * Computes a deterministic SHA256 hash from a JSON-serializable object.
 */
export function hashStructure(obj) {
  const json = JSON.stringify(obj, Object.keys(obj).sort());
  return createHash('sha256').update(json).digest('hex');
}

/**
 * Computes a fingerprint summarizing the structural shape of a store page/API response.
 * Ignores dynamic values (like timestamps, prices, product descriptions).
 */
export function computeFingerprint({
  rawLayoutJson = null,
  authoritativeQuote = null,
  dom = null,
  rawPriceResponse = null,
  rawProductJson = null
} = {}) {
  const layoutRevision = rawLayoutJson?.revision ?? null;
  const layoutVariant = rawLayoutJson?.variant ?? null;
  const layoutKeys = rawLayoutJson && typeof rawLayoutJson === 'object' ? Object.keys(rawLayoutJson).sort() : [];
  const productApiKeys = rawProductJson && typeof rawProductJson === 'object' ? Object.keys(rawProductJson).sort() : [];
  const domKeys = dom && typeof dom === 'object' ? Object.keys(dom).sort() : [];
  const quoteKeys = authoritativeQuote && typeof authoritativeQuote === 'object' ? Object.keys(authoritativeQuote).sort() : null;
  const priceApiKeys = rawPriceResponse && typeof rawPriceResponse === 'object' ? Object.keys(rawPriceResponse).sort() : null;

  const candidateTagNames = Array.isArray(dom?.candidates)
    ? [...new Set(dom.candidates.map(c => c?.tagName).filter(Boolean))].sort()
    : [];

  // Stable structure payload used to generate stable hash
  const stableStructure = {
    fingerprintVersion: FINGERPRINT_VERSION,
    layoutRevision,
    layoutVariant,
    layoutKeys,
    productApiKeys,
    domKeys
  };

  const hash = hashStructure(stableStructure);

  return {
    fingerprintVersion: FINGERPRINT_VERSION,
    hash,
    layoutRevision,
    layoutVariant,
    layoutKeys,
    productApiKeys,
    domKeys,
    quoteKeys,
    priceApiKeys,
    candidateTagNames
  };
}

/**
 * Compares a current fingerprint against a baseline structure.
 * Baseline can be either another fingerprint or a baseline configuration object (e.g. from structure-baseline.json).
 *
 * Severity levels:
 * - 'high': Layout revision/variant changed, layout keys changed, product API keys lost, or missing core quote keys.
 * - 'medium': Unknown quote key, unknown price API key, or DOM envelope keys changed.
 * - 'low': Product API gained a new key, candidate tags changed.
 */
export function compareFingerprints(current, baseline) {
  if (!current || !baseline) {
    throw new Error('Both current and baseline fingerprints are required for comparison');
  }

  const diffs = [];

  // If baseline wraps the stableFingerprint property (like structure-baseline.json)
  const baseLayout = baseline.stableFingerprint || baseline;

  // 1. Layout revision & variant checks (HIGH)
  if (baseLayout.layoutRevision !== undefined && baseLayout.layoutRevision !== null) {
    if (current.layoutRevision !== null && current.layoutRevision !== baseLayout.layoutRevision) {
      diffs.push({
        field: 'layoutRevision',
        severity: 'high',
        baseline: baseLayout.layoutRevision,
        current: current.layoutRevision,
        message: `Layout revision changed from ${baseLayout.layoutRevision} to ${current.layoutRevision}`
      });
    }
  }

  if (baseLayout.layoutVariant !== undefined && baseLayout.layoutVariant !== null) {
    if (current.layoutVariant !== null && current.layoutVariant !== baseLayout.layoutVariant) {
      diffs.push({
        field: 'layoutVariant',
        severity: 'high',
        baseline: baseLayout.layoutVariant,
        current: current.layoutVariant,
        message: `Layout variant changed from ${baseLayout.layoutVariant} to ${current.layoutVariant}`
      });
    }
  }

  // 2. Layout keys check (HIGH)
  if (baseLayout.layoutKeys && current.layoutKeys && current.layoutKeys.length > 0) {
    const baseSet = new Set(baseLayout.layoutKeys);
    const currSet = new Set(current.layoutKeys);
    const missing = baseLayout.layoutKeys.filter(k => !currSet.has(k));
    const added = current.layoutKeys.filter(k => !baseSet.has(k));

    if (missing.length > 0 || added.length > 0) {
      diffs.push({
        field: 'layoutKeys',
        severity: 'high',
        baseline: baseLayout.layoutKeys,
        current: current.layoutKeys,
        missing,
        added,
        message: `Layout keys changed: missing=[${missing.join(', ')}], added=[${added.join(', ')}]`
      });
    }
  }

  // 3. Product API keys check
  if (baseLayout.productApiKeys && current.productApiKeys && current.productApiKeys.length > 0) {
    const baseSet = new Set(baseLayout.productApiKeys);
    const currSet = new Set(current.productApiKeys);
    const missing = baseLayout.productApiKeys.filter(k => !currSet.has(k));
    const added = current.productApiKeys.filter(k => !baseSet.has(k));

    if (missing.length > 0) {
      diffs.push({
        field: 'productApiKeys',
        severity: 'high',
        baseline: baseLayout.productApiKeys,
        current: current.productApiKeys,
        missing,
        message: `Product API lost required keys: [${missing.join(', ')}]`
      });
    }
    if (added.length > 0) {
      diffs.push({
        field: 'productApiKeys',
        severity: 'low',
        baseline: baseLayout.productApiKeys,
        current: current.productApiKeys,
        added,
        message: `Product API gained new keys: [${added.join(', ')}]`
      });
    }
  }

  // 4. DOM keys check (MEDIUM)
  if (baseLayout.domKeys && current.domKeys && current.domKeys.length > 0) {
    const baseSet = new Set(baseLayout.domKeys);
    const currSet = new Set(current.domKeys);
    const missing = baseLayout.domKeys.filter(k => !currSet.has(k));
    const added = current.domKeys.filter(k => !baseSet.has(k));

    if (missing.length > 0 || added.length > 0) {
      diffs.push({
        field: 'domKeys',
        severity: 'medium',
        baseline: baseLayout.domKeys,
        current: current.domKeys,
        missing,
        added,
        message: `DOM envelope keys changed: missing=[${missing.join(', ')}], added=[${added.join(', ')}]`
      });
    }
  }

  // 5. Quote keys check
  const knownQuoteKeys = baseline.knownQuoteKeys || baseLayout.quoteKeys || [];
  const coreQuoteKeys = baseline.coreQuoteKeys || ['c', 'p', 's', 't'];

  if (current.quoteKeys && current.quoteKeys.length > 0) {
    const currQuoteSet = new Set(current.quoteKeys);
    const missingCore = coreQuoteKeys.filter(k => !currQuoteSet.has(k));

    if (missingCore.length > 0) {
      diffs.push({
        field: 'quoteKeys.core',
        severity: 'high',
        baseline: coreQuoteKeys,
        current: current.quoteKeys,
        missing: missingCore,
        message: `Authoritative quote is missing core fields: [${missingCore.join(', ')}]`
      });
    }

    if (knownQuoteKeys.length > 0) {
      const knownSet = new Set(knownQuoteKeys);
      const unknownKeys = current.quoteKeys.filter(k => !knownSet.has(k));
      if (unknownKeys.length > 0) {
        diffs.push({
          field: 'quoteKeys.unknown',
          severity: 'medium',
          baseline: knownQuoteKeys,
          current: current.quoteKeys,
          added: unknownKeys,
          message: `Authoritative quote has unrecognized keys: [${unknownKeys.join(', ')}]`
        });
      }
    }
  }

  // 6. Price API response keys check
  const knownPriceApiKeys = baseline.knownPriceApiKeys || baseLayout.priceApiKeys || [];
  if (knownPriceApiKeys.length > 0 && current.priceApiKeys && current.priceApiKeys.length > 0) {
    const knownSet = new Set(knownPriceApiKeys);
    const unknownKeys = current.priceApiKeys.filter(k => !knownSet.has(k));
    if (unknownKeys.length > 0) {
      diffs.push({
        field: 'priceApiKeys.unknown',
        severity: 'medium',
        baseline: knownPriceApiKeys,
        current: current.priceApiKeys,
        added: unknownKeys,
        message: `Price API response has unrecognized keys: [${unknownKeys.join(', ')}]`
      });
    }
  }

  const hasHighSeverity = diffs.some(d => d.severity === 'high');
  const match = diffs.length === 0;

  return {
    match,
    hasHighSeverity,
    diffs
  };
}
