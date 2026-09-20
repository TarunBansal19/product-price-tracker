import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  computeFingerprint,
  compareFingerprints,
  hashStructure
} from '../../src/store/structureFingerprint.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURES_DIR = path.resolve(__dirname, '../fixtures/real');
const BASELINE_FILE = path.resolve(__dirname, '../fixtures/structure-baseline.json');

test('store/structureFingerprint.js', async t => {
  const baseline = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf-8'));

  await t.test('computeFingerprint: produces deterministic output and hash', () => {
    const mockData = {
      rawLayoutJson: { revision: 123, variant: 1, classes: ['a'], order: ['1'] },
      authoritativeQuote: { p: 100, s: 5, c: 'INR', t: 123456 },
      dom: { candidates: [{ tagName: 'SPAN' }, { tagName: 'BUTTON' }], blockText: '₹100' },
      rawPriceResponse: { v: 1, productId: 10 },
      rawProductJson: { id: 10, name: 'Widget' }
    };

    const fp1 = computeFingerprint(mockData);
    const fp2 = computeFingerprint(mockData);

    assert.equal(fp1.hash, fp2.hash);
    assert.deepEqual(fp1, fp2);
    assert.equal(fp1.layoutRevision, 123);
    assert.equal(fp1.layoutVariant, 1);
    assert.deepEqual(fp1.candidateTagNames, ['BUTTON', 'SPAN']);
  });

  await t.test('computeFingerprint: handles null / partial store payloads without throwing', () => {
    const empty = computeFingerprint({});
    assert.ok(empty.hash);
    assert.equal(empty.layoutRevision, null);
    assert.equal(empty.layoutVariant, null);
    assert.deepEqual(empty.layoutKeys, []);
    assert.deepEqual(empty.quoteKeys, null);
    assert.deepEqual(empty.priceApiKeys, null);
    assert.deepEqual(empty.candidateTagNames, []);
  });

  await t.test('all 12 real fixtures match the baseline stable fingerprint', () => {
    const files = fs.readdirSync(FIXTURES_DIR).filter(f => f.endsWith('.json'));
    assert.ok(files.length >= 10, `Expected at least 10 fixtures, found ${files.length}`);

    for (const f of files) {
      const data = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, f), 'utf-8'));
      const fp = computeFingerprint({
        rawLayoutJson: data.rawLayoutJson,
        authoritativeQuote: data.authoritativeQuote,
        dom: data.dom,
        rawPriceResponse: data.rawPriceResponse,
        rawProductJson: data.rawProductJson
      });

      // Assert stable hash matches baseline exactly
      assert.equal(
        fp.hash,
        baseline.stableFingerprint.hash,
        `Fixture ${f} stable hash should match baseline`
      );

      // Assert comparison with baseline yields no high severity diffs
      const comp = compareFingerprints(fp, baseline);
      assert.equal(
        comp.hasHighSeverity,
        false,
        `Fixture ${f} should not produce HIGH severity diffs: ${JSON.stringify(comp.diffs)}`
      );
    }
  });

  await t.test('compareFingerprints: detects HIGH severity when layout revision or variant changes', () => {
    const current = computeFingerprint({
      rawLayoutJson: { revision: 999999, variant: 0, classes: [], order: [] }
    });

    const comp = compareFingerprints(current, baseline);
    assert.equal(comp.match, false);
    assert.equal(comp.hasHighSeverity, true);
    const revDiff = comp.diffs.find(d => d.field === 'layoutRevision');
    assert.ok(revDiff);
    assert.equal(revDiff.severity, 'high');
  });

  await t.test('compareFingerprints: detects HIGH severity when layout keys are removed', () => {
    const current = computeFingerprint({
      rawLayoutJson: { revision: 627001, variant: 0 } // missing all other keys
    });

    const comp = compareFingerprints(current, baseline);
    assert.equal(comp.match, false);
    assert.equal(comp.hasHighSeverity, true);
    const keyDiff = comp.diffs.find(d => d.field === 'layoutKeys');
    assert.ok(keyDiff);
    assert.equal(keyDiff.severity, 'high');
  });

  await t.test('compareFingerprints: detects HIGH severity when core quote keys are missing', () => {
    const current = computeFingerprint({
      authoritativeQuote: { x: 1 } // missing c, p, s, t
    });

    const comp = compareFingerprints(current, baseline);
    assert.equal(comp.match, false);
    assert.equal(comp.hasHighSeverity, true);
    const quoteDiff = comp.diffs.find(d => d.field === 'quoteKeys.core');
    assert.ok(quoteDiff);
    assert.equal(quoteDiff.severity, 'high');
  });

  await t.test('compareFingerprints: detects MEDIUM severity when unknown quote key appears', () => {
    const current = computeFingerprint({
      authoritativeQuote: { c: 'INR', p: 100, s: 10, t: 12345, brandNewUnknownKey: true }
    });

    const comp = compareFingerprints(current, baseline);
    assert.equal(comp.match, false);
    const unknownDiff = comp.diffs.find(d => d.field === 'quoteKeys.unknown');
    assert.ok(unknownDiff);
    assert.equal(unknownDiff.severity, 'medium');
  });

  await t.test('compareFingerprints: detects LOW severity when product API gains new optional keys', () => {
    const current = computeFingerprint({
      rawProductJson: {
        ...baseline.stableFingerprint.productApiKeys.reduce((acc, k) => ({ ...acc, [k]: 'val' }), {}),
        brandNewField: 'added'
      }
    });

    const comp = compareFingerprints(current, baseline);
    const prodDiff = comp.diffs.find(d => d.field === 'productApiKeys');
    assert.ok(prodDiff);
    assert.equal(prodDiff.severity, 'low');
    assert.equal(comp.hasHighSeverity, false);
  });
});
