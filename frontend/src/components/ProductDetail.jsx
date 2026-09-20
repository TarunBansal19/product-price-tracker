import React, { useState, useEffect, useCallback, useRef } from 'react';
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
  const [isScraping, setIsScraping] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const pollIntervalRef = useRef(null);

  // Stop polling on cleanup
  const stopPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    setIsScraping(false);
  }, []);

  useEffect(() => {
    return () => {
      stopPolling();
    };
  }, [stopPolling]);

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
      return {
        observations: historyRes.observations || [],
        attempts: attemptsRes.attempts || []
      };
    } catch (err) {
      console.error('Failed to load product data:', err);
      return { observations: [], attempts: [] };
    } finally {
      setLoading(false);
    }
  }, [product?.id, selectedRange, getRangeTimestamps]);

  // Fetch initial data when product or range changes
  useEffect(() => {
    stopPolling();
    fetchData();
  }, [product?.id, selectedRange, fetchData, stopPolling]);

  // Synchronize when product.last_attempt_at changes from outside (e.g. background poll)
  useEffect(() => {
    if (product?.last_attempt_at) {
      fetchData();
      setRefreshKey((k) => k + 1);
    }
  }, [product?.last_attempt_at]);

  // Poller function
  const startPollLoop = useCallback(
    ({ baselineAttemptTime = null, isWaitingForInitial = false }) => {
      stopPolling();
      setIsScraping(true);

      const startTime = Date.now();
      const maxDuration = 35000; // 35 seconds max poll

      pollIntervalRef.current = setInterval(async () => {
        const elapsed = Date.now() - startTime;
        try {
          const { observations: newObs, attempts: newAtt } = await fetchData();
          setRefreshKey((k) => k + 1);
          if (onProductUpdated) {
            onProductUpdated();
          }

          let isFinished = false;
          if (isWaitingForInitial) {
            // Finished if any observation or attempt has landed
            if (newObs.length > 0 || newAtt.length > 0) {
              isFinished = true;
            }
          } else {
            // Finished if the latest attempt is newer than before the scrape
            const latestAttemptTime = newAtt[0]?.started_at || null;
            if (latestAttemptTime && latestAttemptTime !== baselineAttemptTime) {
              isFinished = true;
            }
          }

          if (isFinished || elapsed >= maxDuration) {
            stopPolling();
          }
        } catch {
          if (elapsed >= maxDuration) {
            stopPolling();
          }
        }
      }, 1800);
    },
    [fetchData, onProductUpdated, stopPolling]
  );

  // Detect newly tracked product waiting for initial scrape
  useEffect(() => {
    const isPendingInitial =
      Boolean(product?.id) &&
      !product?.latestObservation &&
      (!product?.lastAttempt || product?.lastAttempt?.outcome !== 'failed');

    if (isPendingInitial && !pollIntervalRef.current) {
      startPollLoop({ isWaitingForInitial: true });
    }
  }, [product?.id, product?.latestObservation, product?.lastAttempt, startPollLoop]);

  // Handle manual "Scrape now" trigger
  const handleScrapeNow = async () => {
    if (!product?.id) return;
    const baselineAttemptTime = attempts[0]?.started_at || product?.lastAttempt?.started_at || null;
    setIsScraping(true);

    try {
      await api.triggerManualScrape(product.id);
      startPollLoop({ baselineAttemptTime, isWaitingForInitial: false });
    } catch (err) {
      setIsScraping(false);
      throw err;
    }
  };

  return (
    <div className="product-detail-container" style={{ display: 'flex', flexDirection: 'column', gap: '28px' }}>
      {/* 1. Product Header */}
      <ProductHeader
        product={product}
        isScraping={isScraping}
        onScrapeNow={handleScrapeNow}
        onUntrack={onUntrack}
      />

      {/* 2. Price Block */}
      <PriceBlock
        product={product}
        observations={observations}
        selectedRange={selectedRange}
        isScraping={isScraping}
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
      <ScrapeLog productId={product.id} refreshKey={refreshKey} />
    </div>
  );
}
