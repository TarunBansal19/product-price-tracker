import test from 'node:test';
import assert from 'node:assert/strict';
import { assertStoreOrigin, isStoreOrigin, buildProductUrl, buildApiUrl, ALLOWED_ORIGIN } from '../../src/store/urls.js';

test('store/urls.js', async t => {
  await t.test('buildProductUrl returns valid store URL for numeric IDs', () => {
    const url = buildProductUrl('200');
    assert.equal(url, `${ALLOWED_ORIGIN}/product/200`);

    const urlNum = buildProductUrl(114);
    assert.equal(urlNum, `${ALLOWED_ORIGIN}/product/114`);
  });

  await t.test('buildProductUrl rejects non-numeric or malicious IDs (prevent path traversal / SSRF)', () => {
    assert.throws(() => buildProductUrl('../../etc/passwd'), /Invalid product ID format/);
    assert.throws(() => buildProductUrl('https://evil.com'), /Invalid product ID format/);
    assert.throws(() => buildProductUrl('abc'), /Invalid product ID format/);
    assert.throws(() => buildProductUrl(''), /Product ID is required/);
    assert.throws(() => buildProductUrl(null), /Product ID is required/);
  });

  await t.test('assertStoreOrigin allows valid paths on the store origin', () => {
    assert.doesNotThrow(() => assertStoreOrigin(`${ALLOWED_ORIGIN}/api/catalog`));
    assert.doesNotThrow(() => assertStoreOrigin(`${ALLOWED_ORIGIN}/product/50`));
  });

  await t.test('assertStoreOrigin rejects foreign origins (SSRF guard)', () => {
    assert.throws(() => assertStoreOrigin('https://google.com/test'), /Blocked SSRF/);
    assert.throws(() => assertStoreOrigin('http://169.254.169.254/latest/meta-data'), /Blocked SSRF/);
    assert.throws(() => assertStoreOrigin('javascript:alert(1)'), /Blocked SSRF/);
  });

  await t.test('isStoreOrigin returns boolean correctly', () => {
    assert.equal(isStoreOrigin(`${ALLOWED_ORIGIN}/product/200`), true);
    assert.equal(isStoreOrigin('https://attacker.com/product/200'), false);
  });

  await t.test('buildApiUrl constructs clean API URLs', () => {
    const url = buildApiUrl('/api/catalog?page=1');
    assert.equal(url, `${ALLOWED_ORIGIN}/api/catalog?page=1`);

    const urlWithoutSlash = buildApiUrl('api/layout');
    assert.equal(urlWithoutSlash, `${ALLOWED_ORIGIN}/api/layout`);
  });
});
