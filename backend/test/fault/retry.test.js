import test from 'node:test';
import assert from 'node:assert/strict';
import { withTimeout, calculateBackoff, sleep } from '../../src/runner/retry.js';
import { ERROR_CODES } from '../../src/store/errors.js';

test('runner/retry.js fault tests', async t => {
  await t.test('withTimeout rejects a never-settling promise on timeout', async () => {
    const neverSettling = new Promise(() => {}); // never resolves
    const start = Date.now();

    await assert.rejects(
      async () => withTimeout(neverSettling, 50, { label: 'never_settle' }),
      err => {
        assert.equal(err.code, ERROR_CODES.ATTEMPT_TIMEOUT);
        assert.ok(err.message.includes('timed out after 50ms'));
        return true;
      }
    );

    const elapsed = Date.now() - start;
    assert.ok(elapsed >= 45 && elapsed < 200, `Expected ~50ms, took ${elapsed}ms`);
  });

  await t.test('withTimeout aborts immediately when signal fires', async () => {
    const ac = new AbortController();
    const slowPromise = new Promise(resolve => setTimeout(resolve, 5000));

    const p = withTimeout(slowPromise, 1000, { signal: ac.signal, label: 'aborted_op' });
    ac.abort();

    await assert.rejects(p, err => {
      assert.equal(err.code, ERROR_CODES.INTERRUPTED);
      return true;
    });
  });

  await t.test('calculateBackoff respects baseMs, maxMs, and jitter bounds', () => {
    for (let i = 0; i < 20; i++) {
      const delay = calculateBackoff(1, { baseMs: 1000, maxMs: 10000 });
      // For attempt 1, raw is 1000ms, jitter is 700 - 1300ms
      assert.ok(delay >= 700 && delay <= 1300, `Delay ${delay} out of range [700, 1300]`);
    }

    // High attempt capped at maxMs
    const cappedDelay = calculateBackoff(10, { baseMs: 1000, maxMs: 5000 });
    assert.ok(cappedDelay <= 5000);
  });

  await t.test('calculateBackoff honors Retry-After header', () => {
    const delayFromSec = calculateBackoff(1, { retryAfter: '3', maxMs: 10000 });
    assert.equal(delayFromSec, 3000);
  });

  await t.test('sleep aborts cleanly on signal', async () => {
    const ac = new AbortController();
    const sleepPromise = sleep(5000, ac.signal);
    setTimeout(() => ac.abort(), 20);

    await assert.rejects(sleepPromise, err => err.code === ERROR_CODES.INTERRUPTED);
  });
});
