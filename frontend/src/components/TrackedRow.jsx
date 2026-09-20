import React, { useState, useEffect } from 'react';
import { formatPrice } from '../utils/formatters.js';
import { Sparkline } from './Sparkline.jsx';
import { api } from '../api.js';

export function TrackedRow({ product, isSelected, onSelect }) {
  const [history, setHistory] = useState([]);

  // Fetch observations history for sparkline (last 7 days)
  useEffect(() => {
    let active = true;
    if (product?.id) {
      api.getObservationHistory(product.id, { limit: 50 })
        .then((res) => {
          if (active && res && res.observations) {
            setHistory(res.observations);
          }
        })
        .catch(() => {
          // Gracefully fallback: no sparkline shown
        });
    }
    return () => {
      active = false;
    };
  }, [product?.id, product?.latestObservation?.id]);

  const obs = product.latestObservation;
  const lastAttempt = product.lastAttempt;
  const isFailed = lastAttempt?.outcome === 'failed';
  const isPending = !obs && (!lastAttempt || !product.last_attempt_at);

  // Status computation per Section 3.1
  let dotClass = 'in_stock';
  let statusText = 'In stock';

  if (isPending) {
    dotClass = 'pending';
    statusText = 'First check pending';
  } else if (isFailed) {
    dotClass = 'failed';
    statusText = 'Last scrape failed';
  } else if (obs) {
    if (obs.stock_state === 'in_stock') {
      dotClass = 'in_stock';
      statusText = 'In stock';
    } else if (obs.stock_state === 'low_stock') {
      dotClass = 'low_stock';
      statusText = obs.stock_quantity != null ? `Low stock, ${obs.stock_quantity} left` : 'Low stock';
    } else if (obs.stock_state === 'out_of_stock') {
      dotClass = 'out_of_stock';
      statusText = 'Out of stock';
    } else {
      dotClass = 'in_stock';
      statusText = obs.stock_state.replace(/_/g, ' ');
    }
  }

  // Price formatting: without decimals in the rail list per Figma PNG
  const priceDisplay = obs ? formatPrice(obs.price_minor, obs.currency, false) : '—';

  return (
    <div
      className={`tracked-row ${isSelected ? 'selected' : ''}`}
      onClick={() => onSelect(product)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(product);
        }
      }}
      aria-pressed={isSelected}
    >
      <div className="tracked-row-line1">
        <span className="tracked-row-name" title={product.name}>
          {product.name}
        </span>
        <span className={`tracked-row-price ${isFailed ? 'stale-failed' : ''}`}>
          {priceDisplay}
        </span>
      </div>

      <div className="tracked-row-line2">
        <div className="tracked-row-status">
          <span className={`tracked-status-dot ${dotClass}`} />
          <span>{statusText}</span>
        </div>
        <div className="tracked-row-sparkline">
          <Sparkline observations={history} isSelected={isSelected} />
        </div>
      </div>
    </div>
  );
}
