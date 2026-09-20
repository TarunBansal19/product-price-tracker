import React, { useState, useEffect, useCallback } from 'react';
import { ProductHeader } from './ProductHeader.jsx';
import { PriceBlock } from './PriceBlock.jsx';
import { ChartSection } from './ChartSection.jsx';
import { ScrapeLog } from './ScrapeLog.jsx';
import { api } from '../api.js';

export function ProductDetail({ product, onProductUpdated, onUntrack }) {
  const [observations, setObservations] = useState([]);
  const [attempts, setAttempts] = useState([]);
  const [selectedRange, setSelectedRange] = useState('7d');
  const [loading, setLoading] = useState(false);

  // Calculate ISO range strings
  const getRangeTimestamps = useCallback((range) => {
    const now = new Date();
    let fromDate = new Date();
    if (range === '24h') {
      fromDate.setHours(fromDate.getHours() - 24);
    } else if (range === '7d') {
      fromDate.setDate(fromDate.getDate() - 7);
    } else if (range === '30d') {
      fromDate.setDate(fromDate.getDate() - 30);
    } else {
      fromDate = null; // all time
    }
    return {
      from: fromDate ? fromDate.toISOString() : undefined,
      to: now.toISOString()
    };
  }, []);

  const fetchData = useCallback(async () => {
    if (!product?.id) return;
    setLoading(true);
    try {
      const { from, to } = getRangeTimestamps(selectedRange);
      const [historyRes, attemptsRes] = await Promise.all([
        api.getObservationHistory(product.id, { from, to, limit: 500 }),
        api.getAttemptLog(product.id, { limit: 100 })
      ]);
      setObservations(historyRes.observations || []);
      setAttempts(attemptsRes.attempts || []);
    } catch (err) {
      console.error('Failed to load product data:', err);
    } finally {
      setLoading(false);
    }
  }, [product?.id, selectedRange, getRangeTimestamps]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleRefreshAll = async () => {
    await fetchData();
    if (onProductUpdated) {
      onProductUpdated();
    }
  };

  return (
    <div className="product-detail-container" style={{ display: 'flex', flexDirection: 'column', gap: '28px' }}>
      {/* 1. Product Header */}
      <ProductHeader
        product={product}
        onProductUpdated={handleRefreshAll}
        onUntrack={onUntrack}
      />

      {/* 2. Price Block */}
      <PriceBlock
        product={product}
        observations={observations}
        selectedRange={selectedRange}
      />

      {/* 3. Chart Section (Section 4) */}
      <ChartSection
        productId={product.id}
        observations={observations}
        attempts={attempts}
        selectedRange={selectedRange}
        onRangeChange={(range) => setSelectedRange(range)}
      />

      {/* 4. Scrape Log Section (Section 5) */}
      <ScrapeLog productId={product.id} />
    </div>
  );
}
