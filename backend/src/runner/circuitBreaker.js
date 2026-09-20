/**
 * runner/circuitBreaker.js - Circuit breaker protecting store and free-tier budget.
 * Opens after N consecutive infrastructure errors (timeouts, 5xx, network).
 */

import { ERROR_CODES } from '../store/errors.js';

const INFRASTRUCTURE_ERROR_CODES = new Set([
  ERROR_CODES.ATTEMPT_TIMEOUT,
  ERROR_CODES.NAV_TIMEOUT,
  ERROR_CODES.NETWORK_ERROR,
  ERROR_CODES.HTTP_5XX,
  ERROR_CODES.HTTP_429,
  ERROR_CODES.BROWSER_CRASHED
]);

export class CircuitBreaker {
  constructor({ threshold = 5, probeCooldownMs = 45000 } = {}) {
    this.threshold = threshold;
    this.probeCooldownMs = probeCooldownMs;
    this.consecutiveFailures = 0;
    this.isOpen = false;
    this.openedAt = null;
    this.isHalfOpen = false;
  }

  recordSuccess() {
    this.consecutiveFailures = 0;
    this.isOpen = false;
    this.openedAt = null;
    this.isHalfOpen = false;
  }

  recordFailure(errorCode) {
    // Only infrastructure-like errors trip the breaker per §8.8
    if (!INFRASTRUCTURE_ERROR_CODES.has(errorCode)) {
      return;
    }

    this.consecutiveFailures++;
    if (this.consecutiveFailures >= this.threshold) {
      this.isOpen = true;
      this.openedAt = Date.now();
      this.isHalfOpen = false;
    }
  }

  canExecute() {
    if (!this.isOpen) return true;

    // Check if probe cooldown has elapsed
    const elapsed = Date.now() - (this.openedAt || 0);
    if (elapsed >= this.probeCooldownMs && !this.isHalfOpen) {
      // Allow single probe attempt
      this.isHalfOpen = true;
      return true;
    }

    return false;
  }

  getState() {
    return {
      isOpen: this.isOpen,
      isHalfOpen: this.isHalfOpen,
      consecutiveFailures: this.consecutiveFailures,
      openedAt: this.openedAt
    };
  }

  reset() {
    this.consecutiveFailures = 0;
    this.isOpen = false;
    this.openedAt = null;
    this.isHalfOpen = false;
  }
}
