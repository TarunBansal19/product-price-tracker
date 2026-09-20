import test from 'node:test';
import assert from 'node:assert/strict';
import { validationGates } from '../../src/store/validate.js';
import { ERROR_CODES } from '../../src/store/errors.js';

test('store/validate.js gates V1-V9', async t => {
  await t.test('V1: flags HTTP errors and soft error pages', () => {
    assert.throws(
      () => validationGates.checkV1ExpectedContent({ httpStatus: 404 }),
      err => err.code === ERROR_CODES.NOT_FOUND
    );
    assert.throws(
      () => validationGates.checkV1ExpectedContent({ httpStatus: 503 }),
      err => err.code === ERROR_CODES.HTTP_5XX
    );
    assert.throws(
      () => validationGates.checkV1ExpectedContent({ httpStatus: 200, isSoftError: true }),
      err => err.code === ERROR_CODES.UNEXPECTED_CONTENT
    );
    assert.doesNotThrow(() => validationGates.checkV1ExpectedContent({ httpStatus: 200, body: 'ok' }));
  });

  await t.test('V2: rejects placeholders (Loading, Price hidden, etc)', () => {
    assert.throws(
      () => validationGates.checkV2ContentReady({ rawText: 'Loading current price...' }),
      err => err.code === ERROR_CODES.CONTENT_NOT_READY
    );
    assert.throws(
      () => validationGates.checkV2ContentReady({ rawText: 'Price hidden' }),
      err => err.code === ERROR_CODES.CONTENT_NOT_READY
    );
    assert.doesNotThrow(() => validationGates.checkV2ContentReady({ rawText: '₹12,723' }));
  });

  await t.test('V3: enforces product identity match', () => {
    assert.throws(
      () => validationGates.checkV3ProductIdentity({ requestedId: '200', receivedId: '114' }),
      err => err.code === ERROR_CODES.PRODUCT_MISMATCH
    );
    assert.doesNotThrow(() => validationGates.checkV3ProductIdentity({ requestedId: '200', receivedId: 200 }));
  });

  await t.test('V4: validates price sanity', () => {
    assert.throws(
      () => validationGates.checkV4PriceSane({ priceMinor: 0n, currency: 'INR' }),
      err => err.code === ERROR_CODES.PRICE_IMPLAUSIBLE
    );
    assert.throws(
      () => validationGates.checkV4PriceSane({ priceMinor: 1000n, currency: 'TOOLONG' }),
      err => err.code === ERROR_CODES.PRICE_UNPARSEABLE
    );
    assert.doesNotThrow(() => validationGates.checkV4PriceSane({ priceMinor: 1272300n, currency: 'INR' }));
  });

  await t.test('V5: rejects ambiguous prices', () => {
    assert.throws(
      () => validationGates.checkV5PriceUnambiguous({ candidates: [{ priceMinor: 100n }, { priceMinor: 200n }] }),
      err => err.code === ERROR_CODES.PRICE_AMBIGUOUS
    );
    assert.doesNotThrow(
      () => validationGates.checkV5PriceUnambiguous({ candidates: [{ priceMinor: 100n }, { priceMinor: 100n }] })
    );
  });

  await t.test('V6: checks price stability', () => {
    assert.throws(
      () => validationGates.checkV6Stability({ read1Minor: 1000n, read2Minor: 1200n }),
      err => err.code === ERROR_CODES.PRICE_UNSTABLE
    );
    assert.doesNotThrow(() => validationGates.checkV6Stability({ read1Minor: 1000n, read2Minor: 1000n }));
  });

  await t.test('V7: flags unconfirmed large outliers', () => {
    // 50% increase (> 35% default)
    assert.throws(
      () => validationGates.checkV7Outlier({ newPriceMinor: 150000n, lastPriceMinor: 100000n, isConfirmed: false }),
      err => err.code === ERROR_CODES.PRICE_IMPLAUSIBLE
    );
    // Confirmed outlier allowed
    assert.doesNotThrow(
      () => validationGates.checkV7Outlier({ newPriceMinor: 150000n, lastPriceMinor: 100000n, isConfirmed: true })
    );
  });

  await t.test('V8: validates stock states and consistency', () => {
    assert.throws(
      () => validationGates.checkV8StockRecognized({ stockState: 'some_unknown_state' }),
      err => err.code === ERROR_CODES.STOCK_UNRECOGNIZED
    );
    assert.throws(
      () => validationGates.checkV8StockRecognized({ stockState: 'out_of_stock', quantity: 15 }),
      err => err.code === ERROR_CODES.STOCK_CONFLICT
    );
    assert.doesNotThrow(() => validationGates.checkV8StockRecognized({ stockState: 'in_stock', quantity: 96 }));
  });

  await t.test('V9: validates freshness / token age', () => {
    const expiredTs = Date.now() - 300000; // 5 mins old
    assert.throws(
      () => validationGates.checkV9Freshness({ quoteTimestamp: expiredTs, maxAgeMs: 60000 }),
      err => err.code === ERROR_CODES.TOKEN_EXPIRED
    );
    assert.doesNotThrow(() => validationGates.checkV9Freshness({ quoteTimestamp: Date.now() - 1000 }));
  });
});
