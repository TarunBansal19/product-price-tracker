import React from 'react';
import { formatPrice, formatStock, formatDistanceToNow } from '../utils/formatters.js';

export function PriceBlock({ product, observations = [], selectedRange = '7d', isScraping = false }) {
  const obs = product?.latestObservation;
  const lastAttempt = product?.lastAttempt;
  const hasObservation = Boolean(obs && obs.price_minor);
  const isLastCheckFailed = lastAttempt?.outcome === 'failed';

  if (!hasObservation) {
    return (
      <div className="price-block">
        <div className="big-price" style={{ opacity: isScraping ? 0.85 : 1 }}>
          {isScraping ? 'Checking price...' : 'No price yet'}
        </div>
        <div className="price-summary-sentence">
          <span className="price-change-text slate" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
            {isScraping ? (
              <>
                <span className="sync-pulse-dot" />
                <span>The first scrape is in progress. The price will appear here automatically...</span>
              </>
            ) : isLastCheckFailed ? (
              'The initial check could not read price. Click "Scrape now" above to try again.'
            ) : (
              'The first check is running now.'
            )}
          </span>
        </div>
      </div>
    );
  }

  // 1. Big price (Bricolage 52) from the latest successful observation
  const bigPriceText = formatPrice(obs.price_minor, obs.currency, true);

  // 2. Compute price change vs the first observation in the selected range
  let changeText = 'Price unchanged since tracking began.';
  let changeVariant = 'slate';

  if (observations && observations.length >= 2) {
    const sorted = [...observations].sort(
      (a, b) => new Date(a.observed_at).getTime() - new Date(b.observed_at).getTime()
    );
    const firstInWindow = sorted[0];
    const diff = Number(obs.price_minor) - Number(firstInWindow.price_minor);

    let rangeWording = 'than a week ago';
    if (selectedRange === '24h') rangeWording = 'than yesterday';
    else if (selectedRange === '7d') rangeWording = 'than a week ago';
    else if (selectedRange === '30d') rangeWording = 'than 30 days ago';
    else if (selectedRange === 'all') rangeWording = 'since tracking began';

    if (diff === 0) {
      changeText = `Price unchanged ${rangeWording}.`;
      changeVariant = 'slate';
    } else {
      const diffFormatted = formatPrice(Math.abs(diff), obs.currency, false);
      if (diff < 0) {
        changeText = `${diffFormatted} lower ${rangeWording}.`;
        changeVariant = 'live';
      } else {
        changeText = `${diffFormatted} higher ${rangeWording}.`;
        changeVariant = 'red';
      }
    }
  } else {
    let rangeWording = 'since tracking began';
    if (selectedRange === '24h') rangeWording = 'than yesterday';
    else if (selectedRange === '7d') rangeWording = 'than a week ago';
    else if (selectedRange === '30d') rangeWording = 'than 30 days ago';
    changeText = `Price unchanged ${rangeWording}.`;
    changeVariant = 'slate';
  }

  // 3. Stock text: e.g. "In stock, 14 left." or "In stock."
  const stockFormatted = formatStock(obs.stock_state, obs.stock_quantity);
  const stockText = stockFormatted ? `${stockFormatted}.` : '';

  // 4. Last checked time from the last successful observation
  const lastCheckedText = `Last checked ${formatDistanceToNow(obs.observed_at)}.`;

  return (
    <div className="price-block">
      <div className="big-price">{bigPriceText}</div>
      <div className="price-summary-sentence">
        <span className={`price-change-text ${changeVariant}`}>{changeText}</span>{' '}
        <span>{stockText}</span>{' '}
        <span>{lastCheckedText}</span>{' '}
        {isScraping && (
          <span className="sync-badge" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: 'var(--live)', fontWeight: 500, marginLeft: '6px' }}>
            <span className="sync-pulse-dot" style={{ width: 6, height: 6 }} />
            <span>Updating price...</span>
          </span>
        )}
        {isLastCheckFailed && !isScraping && (
          <span className="price-failure-warning">
            The latest check failed; showing the last good price.
          </span>
        )}
      </div>
    </div>
  );
}
