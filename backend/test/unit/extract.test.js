import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalizeText, parsePrice, parseStock, pickPrice } from '../../src/store/extract/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURES_DIR = path.resolve(__dirname, '../fixtures/real');

test('extract/normalizeText.js', async t => {
  await t.test('strips zero-width characters and normalizes Unicode NFKC', () => {
    // String with zero-width space and non-breaking space
    const dirty = '₹\u200B12\u00A0723\uFEFF';
    assert.equal(normalizeText(dirty), '₹12 723');
  });

  await t.test('collapses whitespace and handles null/undefined', () => {
    assert.equal(normalizeText('  Rs.   10,500 \n\t /-  '), 'Rs. 10,500 /-');
    assert.equal(normalizeText(null), '');
    assert.equal(normalizeText(undefined), '');
  });
});

test('extract/parsePrice.js', async t => {
  await t.test('parses standard Indian rupee format', () => {
    const res = parsePrice('₹12,723');
    assert.equal(res.priceMinor, 1272300n);
    assert.equal(res.currency, 'INR');
  });

  await t.test('parses spaced format', () => {
    const res = parsePrice('₹12 723');
    assert.equal(res.priceMinor, 1272300n);
  });

  await t.test('parses euro comma-decimal format', () => {
    const res = parsePrice('₹12.723,00');
    assert.equal(res.priceMinor, 1272300n);
  });

  await t.test('parses trailing taxes format', () => {
    const res = parsePrice('₹12,723/- (incl. of all taxes)');
    assert.equal(res.priceMinor, 1272300n);
  });

  await t.test('parses full-width Unicode digits', () => {
    const res = parsePrice('₹９,１９９');
    assert.equal(res.priceMinor, 919900n);
  });

  await t.test('parses lakh format with Rs. prefix', () => {
    const res = parsePrice('Rs. 12,723.00');
    assert.equal(res.priceMinor, 1272300n);
  });

  await t.test('rejects negative, zero, and unparseable values', () => {
    assert.throws(() => parsePrice('₹0'), /Price must be positive/);
    assert.throws(() => parsePrice('Loading...'), /No digits found/);
    assert.throws(() => parsePrice(''), /Price input is empty/);
  });
});

test('extract/parseStock.js', async t => {
  await t.test('parses observed store phrasings', () => {
    assert.deepEqual(parseStock('In stock · 96 left'), {
      stockState: 'in_stock',
      quantity: 96,
      rawText: 'In stock · 96 left'
    });

    assert.deepEqual(parseStock('Only 5 left'), {
      stockState: 'low_stock',
      quantity: 5,
      rawText: 'Only 5 left'
    });

    assert.deepEqual(parseStock('Selling fast — 4 left'), {
      stockState: 'low_stock',
      quantity: 4,
      rawText: 'Selling fast — 4 left'
    });

    assert.deepEqual(parseStock('Hurry, just 2 left'), {
      stockState: 'low_stock',
      quantity: 2,
      rawText: 'Hurry, just 2 left'
    });

    assert.deepEqual(parseStock('Out of stock'), {
      stockState: 'out_of_stock',
      quantity: 0,
      rawText: 'Out of stock'
    });
  });

  await t.test('rejects missing or unrecognized stock', () => {
    assert.throws(() => parseStock(''), /Stock information is missing/);
    assert.throws(() => parseStock('Some random string'), /Unrecognized stock phrasing/);
  });
});

test('extract against real captured fixtures', async t => {
  const fixtureFiles = fs.readdirSync(FIXTURES_DIR).filter(f => f.endsWith('.json'));
  assert.ok(fixtureFiles.length >= 5, `Expected at least 5 fixtures, found ${fixtureFiles.length}`);

  let testedCount = 0;
  for (const file of fixtureFiles) {
    const content = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, file), 'utf-8'));
    if (content.authoritativeQuote && content.authoritativeQuote.p) {
      testedCount++;
      const res = pickPrice({
        authoritativeQuote: content.authoritativeQuote,
        domCandidates: content.dom?.candidates || [],
        blockText: content.dom?.blockText || ''
      });

      assert.ok(res.priceMinor > 0n, `Price minor should be positive for ${file}`);
      assert.equal(res.currency, 'INR');
      assert.ok(['in_stock', 'low_stock', 'out_of_stock'].includes(res.stockState));
      assert.equal(res.priceMinor, BigInt(content.authoritativeQuote.p) * 100n);
    }
  }

  assert.ok(testedCount >= 4, `Successfully validated ${testedCount} real fixtures`);
});
