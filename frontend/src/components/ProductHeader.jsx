import React, { useState, useEffect } from 'react';
import { api } from '../api.js';

export function ProductHeader({ product, isScraping = false, onScrapeNow, onUntrack }) {
  const [cooldown, setCooldown] = useState(0);

  // Cooldown timer
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => {
      setCooldown((c) => Math.max(0, c - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const handleScrapeClick = async () => {
    if (!product?.id || isScraping || cooldown > 0) return;
    try {
      await onScrapeNow();
      setCooldown(60);
    } catch (err) {
      if (err.status === 409 || (err.code && err.code.includes('COOLDOWN'))) {
        setCooldown(60);
      }
      alert(`Scrape request: [${err.code || 'ERROR'}] ${err.message}`);
    }
  };

  const handleStopTracking = async () => {
    if (!product?.id) return;
    const confirmed = window.confirm(
      `Stop tracking "${product.name}"? Historical scrape data will be preserved.`
    );
    if (!confirmed) return;

    try {
      await api.untrackProduct(product.id);
      if (onUntrack) {
        onUntrack(product.id);
      }
    } catch (err) {
      alert(`Failed to stop tracking: [${err.code || 'ERROR'}] ${err.message}`);
    }
  };

  const isDisabled = isScraping || cooldown > 0;

  return (
    <div className="product-header">
      <div className="product-title-row">
        <h1 className="product-title">{product.name}</h1>
        <div className="product-actions">
          <button
            type="button"
            className="btn-outline"
            disabled={isDisabled}
            onClick={handleScrapeClick}
          >
            {isScraping ? (
              <>
                <span className="scraping-spinner" aria-hidden="true" />
                <span>Scraping...</span>
              </>
            ) : cooldown > 0 ? (
              `Scrape in ${cooldown}s`
            ) : (
              'Scrape now'
            )}
          </button>
          <button
            type="button"
            className="btn-text"
            onClick={handleStopTracking}
          >
            Stop tracking
          </button>
        </div>
      </div>

      <div className="product-meta-row">
        <span>{product.category || 'General'}</span>
        <span>Store ID {product.store_product_id}</span>
      </div>
    </div>
  );
}
