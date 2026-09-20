import React, { useState, useEffect } from 'react';
import { api } from '../api.js';

export function ProductHeader({ product, onProductUpdated, onUntrack }) {
  const [scraping, setScraping] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  // Cooldown timer
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => {
      setCooldown((c) => Math.max(0, c - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const handleScrapeNow = async () => {
    if (!product?.id || scraping || cooldown > 0) return;
    setScraping(true);
    try {
      await api.triggerManualScrape(product.id);
      // Start 60s cooldown per server rate limit rule
      setCooldown(60);
      if (onProductUpdated) {
        // Trigger refetch after a short wait so backend job runner has kicked off
        setTimeout(onProductUpdated, 3000);
        setTimeout(onProductUpdated, 8000);
      }
    } catch (err) {
      if (err.status === 409 || (err.code && err.code.includes('COOLDOWN'))) {
        setCooldown(60);
      }
      alert(`Scrape request: [${err.code || 'ERROR'}] ${err.message}`);
    } finally {
      setScraping(false);
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

  return (
    <div className="product-header">
      <div className="product-title-row">
        <h1 className="product-title">{product.name}</h1>
        <div className="product-actions">
          <button
            type="button"
            className="btn-outline"
            disabled={scraping || cooldown > 0}
            onClick={handleScrapeNow}
          >
            {scraping
              ? 'Scraping...'
              : cooldown > 0
              ? `Scrape in ${cooldown}s`
              : 'Scrape now'}
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
