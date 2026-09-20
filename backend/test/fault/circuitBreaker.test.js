import test from 'node:test';
import assert from 'node:assert/strict';
import { CircuitBreaker } from '../../src/runner/circuitBreaker.js';
import { ERROR_CODES } from '../../src/store/errors.js';

test('runner/circuitBreaker.js fault tests', async t => {
  await t.test('circuit breaker stays closed for non-infrastructure errors', () => {
    const cb = new CircuitBreaker({ threshold: 3 });

    // Price and stock errors should NOT trip the breaker
    cb.recordFailure(ERROR_CODES.PRICE_UNPARSEABLE);
    cb.recordFailure(ERROR_CODES.STOCK_UNRECOGNIZED);
    cb.recordFailure(ERROR_CODES.PRICE_AMBIGUOUS);
    cb.recordFailure(ERROR_CODES.STOCK_MISSING);

    assert.equal(cb.canExecute(), true);
    assert.equal(cb.getState().isOpen, false);
  });

  await t.test('circuit breaker opens after N consecutive infrastructure errors', () => {
    const cb = new CircuitBreaker({ threshold: 3, probeCooldownMs: 1000 });

    cb.recordFailure(ERROR_CODES.ATTEMPT_TIMEOUT);
    assert.equal(cb.canExecute(), true);

    cb.recordFailure(ERROR_CODES.HTTP_5XX);
    assert.equal(cb.canExecute(), true);

    cb.recordFailure(ERROR_CODES.NETWORK_ERROR);
    // Now open!
    assert.equal(cb.getState().isOpen, true);
    assert.equal(cb.canExecute(), false);
  });

  await t.test('circuit breaker allows probe after probeCooldownMs', async () => {
    const cb = new CircuitBreaker({ threshold: 2, probeCooldownMs: 50 });

    cb.recordFailure(ERROR_CODES.HTTP_5XX);
    cb.recordFailure(ERROR_CODES.HTTP_5XX);
    assert.equal(cb.canExecute(), false);

    // Wait for cooldown
    await new Promise(r => setTimeout(r, 60));

    // Allows probe
    assert.equal(cb.canExecute(), true);
    assert.equal(cb.getState().isHalfOpen, true);

    // If probe succeeds, resets
    cb.recordSuccess();
    assert.equal(cb.getState().isOpen, false);
    assert.equal(cb.canExecute(), true);
  });
});
