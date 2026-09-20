import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../api.js';
import { formatTimestamp, formatDuration, formatPrice, formatStock } from '../utils/formatters.js';

// Plain English mapping for error codes per Section 5 of frontend-spec.md
const ERROR_DESCRIPTIONS = {
  ATTEMPT_TIMEOUT: 'No response in 30 s. Trying again.',
  NAV_TIMEOUT: 'Navigation timed out. Store page was slow to respond.',
  NETWORK_ERROR: 'Network connection failed (DNS/TLS/connection reset).',
  HTTP_5XX: 'Store returned an error on all 4 tries. Nothing saved.',
  HTTP_429: 'Store rate limit hit. Backing off before next try.',
  GATE_NOT_PASSED: 'Store anti-bot challenge could not be satisfied.',
  TOKEN_EXPIRED: 'Price session token expired before quote could be read.',
  CONTENT_NOT_READY: 'Price and stock elements did not hydrate in time.',
  PRICE_UNPARSEABLE: 'Price format could not be parsed from page.',
  PRICE_AMBIGUOUS: 'Multiple conflicting prices found on page.',
  PRICE_IMPLAUSIBLE: 'Price changed drastically without confirmation.',
  STOCK_MISSING: 'Stock indicator not found on product page.',
  STOCK_UNRECOGNIZED: 'Stock status text was unrecognized.',
  NOT_FOUND: 'Store returned 404 not found for this product.',
  INTERRUPTED: 'Scrape was interrupted by server shutdown/redeploy.',
  SKIPPED_CIRCUIT_OPEN: 'Skipped because circuit breaker is open.',
  SKIPPED_RUN_DEADLINE: 'Skipped to respect overall run deadline.'
};

export function ScrapeLog({ productId }) {
  const [attempts, setAttempts] = useState([]);
  const [filter, setFilter] = useState('all'); // 'all' | 'retried' | 'failed'
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const pageSize = 20;

  const fetchAttempts = useCallback(
    async (cursor = null, isAppend = false) => {
      if (!productId) return;
      if (isAppend) setLoadingMore(true);
      else setLoading(true);

      try {
        const outcomeParam = filter === 'all' ? undefined : filter;
        const res = await api.getAttemptLog(productId, {
          limit: pageSize,
          before: cursor,
          outcome: outcomeParam
        });

        const newItems = res.attempts || [];
        if (isAppend) {
          setAttempts((prev) => [...prev, ...newItems]);
        } else {
          setAttempts(newItems);
        }

        // If returned fewer than pageSize, there are no older attempts
        setHasMore(newItems.length === pageSize);
      } catch (err) {
        console.error('Failed to load scrape attempts:', err);
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [productId, filter]
  );

  useEffect(() => {
    fetchAttempts(null, false);
  }, [fetchAttempts]);

  const handleShowOlder = () => {
    if (attempts.length === 0 || loadingMore) return;
    const oldest = attempts[attempts.length - 1];
    if (oldest && oldest.started_at) {
      fetchAttempts(oldest.started_at, true);
    }
  };

  const renderWhatHappened = (attempt) => {
    if (attempt.outcome === 'success') {
      const obs = attempt.observation;
      if (obs && obs.price_minor) {
        const priceText = formatPrice(obs.price_minor, obs.currency, true);
        const stockText = formatStock(obs.stock_state, obs.stock_quantity).toLowerCase();
        return `Saved ${priceText}, ${stockText}`;
      }
      if (attempt.attempt_number > 1) {
        return `Saved after ${attempt.attempt_number - 1} ${attempt.attempt_number === 2 ? 'retry' : 'retries'}`;
      }
      return 'Saved. Price and stock passed every check';
    }

    // Failures and retries
    const code = attempt.error_code || 'SCRAPE_ERROR';
    const desc = ERROR_DESCRIPTIONS[code] || attempt.error_message || 'Scrape attempt failed.';
    return (
      <span className="what-happened-text">
        <strong className="what-happened-code">{code}</strong>
        <span className="what-happened-desc">{desc}</span>
      </span>
    );
  };

  const getOutcomeBadgeLabel = (outcome) => {
    if (outcome === 'success') return 'Success';
    if (outcome === 'retried') return 'Retried';
    if (outcome === 'failed') return 'Failed';
    return outcome || 'Unknown';
  };

  return (
    <section className="scrape-log-section" aria-labelledby="scrape-log-title">
      <div className="scrape-log-header-row">
        <div className="scrape-log-title-block">
          <h2 id="scrape-log-title" className="scrape-log-title">Scrape log</h2>
          <span className="scrape-log-subtitle">
            Every attempt is listed, including failures. Times are in IST.
          </span>
        </div>

        {/* Filter Segmented Control */}
        <div className="segmented-control" role="tablist" aria-label="Filter scrape log">
          <button
            type="button"
            role="tab"
            aria-selected={filter === 'all'}
            className={`segmented-option ${filter === 'all' ? 'active' : ''}`}
            onClick={() => setFilter('all')}
          >
            All
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={filter === 'retried'}
            className={`segmented-option ${filter === 'retried' ? 'active' : ''}`}
            onClick={() => setFilter('retried')}
          >
            Retried
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={filter === 'failed'}
            className={`segmented-option ${filter === 'failed' ? 'active' : ''}`}
            onClick={() => setFilter('failed')}
          >
            Failed
          </button>
        </div>
      </div>

      {loading && attempts.length === 0 ? (
        <div style={{ padding: '24px 0', color: 'var(--slate)', fontStyle: 'italic' }}>
          Loading scrape attempts...
        </div>
      ) : attempts.length === 0 ? (
        <div style={{ padding: '24px 0', color: 'var(--slate)' }}>
          No scrape attempts found for the selected filter.
        </div>
      ) : (
        <div className="scrape-log-table-wrapper" style={{ width: '100%', overflowX: 'auto' }}>
          <table className="scrape-log-table">
            <thead>
              <tr>
                <th className="col-time">Time</th>
                <th className="col-outcome">Outcome</th>
                <th className="col-attempt">Attempt</th>
                <th className="col-took">Took</th>
                <th>What happened</th>
              </tr>
            </thead>
            <tbody>
              {attempts.map((attempt) => {
                const ts = formatTimestamp(attempt.started_at);
                const outcome = attempt.outcome || 'retried';
                const tookText = formatDuration(attempt.duration_ms);

                return (
                  <tr key={attempt.id}>
                    <td className="col-time">
                      <span title={ts.utc}>{ts.text}</span>
                    </td>
                    <td className="col-outcome">
                      <span className={`outcome-badge ${outcome}`}>
                        <span className="outcome-dot" />
                        <span>{getOutcomeBadgeLabel(outcome)}</span>
                      </span>
                    </td>
                    <td className="col-attempt">
                      {attempt.attempt_number} of 4
                    </td>
                    <td className="col-took">
                      {tookText}
                    </td>
                    <td>
                      {renderWhatHappened(attempt)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {hasMore && attempts.length > 0 && (
        <div className="scrape-log-footer">
          <button
            type="button"
            className="btn-show-older"
            onClick={handleShowOlder}
            disabled={loadingMore}
          >
            {loadingMore ? 'Loading older attempts...' : 'Show older attempts'}
          </button>
        </div>
      )}
    </section>
  );
}
