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

  const pollTimerRef = useRef(null);
  const productIdRef = useRef(product?.id);

  // Keep productIdRef current so polling can bail out if product changes
  useEffect(() => {
    productIdRef.current = product?.id;
  }, [product?.id]);

  // Stop polling on cleanup
  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    setIsScraping(false);
  }, []);

  useEffect(() => {
    return () => stopPolling();
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
    if (!product?.id) return { observations: [], attempts: [] };
    setLoading(true);
    try {
      const { from, to } = getRangeTimestamps(selectedRange);
      const [historyRes, attemptsRes] = await Promise.all([
        api.getObservationHistory(product.id, { from, to, limit: 500 }),
        api.getAttemptLog(product.id, { limit: 100 })
      ]);
      const obs = historyRes.observations || [];
      const att = attemptsRes.attempts || [];
      setObservations(obs);
      setAttempts(att);
      return { observations: obs, attempts: att };
    } catch (err) {
      console.error('Failed to load product data:', err);
      return { observations: [], attempts: [] };
    } finally {
      setLoading(false);
    }
  }, [product?.id, selectedRange, getRangeTimestamps]);

  // Fetch data when product or range changes
  useEffect(() => {
    stopPolling();
    fetchData();
  }, [product?.id, selectedRange, fetchData, stopPolling]);

  // Synchronize when product.last_attempt_at changes from outside (e.g. background poll)
  useEffect(() => {
    if (product?.last_attempt_at && !isScraping) {
      fetchData();
      setRefreshKey((k) => k + 1);
    }
  }, [product?.last_attempt_at]);

  /**
   * Poll loop using recursive setTimeout (not setInterval) so each tick
   * waits for the previous fetch to complete before scheduling the next.
   *
   * Completion conditions:
   * - Initial scrape: any observation OR a terminal attempt (success/failed) has landed
   * - Manual scrape: a NEW terminal attempt (success/failed) with started_at > baseline
   *
   * After detecting completion, does one trailing refresh 1.5s later for write-lag safety.
   */
  const startPollLoop = useCallback(
    ({ baselineAttemptTime = null, baselineObsCount = 0, isWaitingForInitial = false }) => {
      stopPolling();
      setIsScraping(true);

      const startTime = Date.now();
      const maxDuration = 45000; // 45 seconds covers worst-case 4-attempt retry chain
      const savedProductId = productIdRef.current;

      const doTrailingRefresh = () => {
        // One final fetch 1.5s after detecting completion (catches any DB write lag)
        setTimeout(async () => {
          if (productIdRef.current !== savedProductId) return;
          await fetchData();
          setRefreshKey((k) => k + 1);
          if (onProductUpdated) onProductUpdated();
        }, 1500);
      };

      const tick = async () => {
        // Bail if product changed or component unmounted
        if (productIdRef.current !== savedProductId) {
          stopPolling();
          return;
        }

        const elapsed = Date.now() - startTime;
        if (elapsed >= maxDuration) {
          stopPolling();
          doTrailingRefresh();
          return;
        }

        try {
          const { observations: newObs, attempts: newAtt } = await fetchData();
          setRefreshKey((k) => k + 1);
          if (onProductUpdated) onProductUpdated();

          let isFinished = false;

          if (isWaitingForInitial) {
            // For initial scrape: done when ANY observation lands, or a terminal attempt exists
            if (newObs.length > 0) {
              isFinished = true;
            } else if (newAtt.length > 0) {
              const latest = newAtt[0];
              if (latest.outcome === 'success' || latest.outcome === 'failed') {
                isFinished = true;
              }
              // outcome === 'retried' means the scrape is still in progress — keep polling
            }
          } else {
            // For manual scrape: done when a NEW terminal attempt (not "retried") appears
            // that is strictly newer than the baseline
            const newTerminal = newAtt.find(
              (a) =>
                (a.outcome === 'success' || a.outcome === 'failed') &&
                a.started_at !== baselineAttemptTime &&
                (!baselineAttemptTime || a.started_at > baselineAttemptTime)
            );
            if (newTerminal) {
              isFinished = true;
            }
            // Also check if new observations appeared (covers case where attempt timestamps match)
            if (newObs.length > baselineObsCount) {
              isFinished = true;
            }
          }

          if (isFinished) {
            stopPolling();
            doTrailingRefresh();
            return;
          }
        } catch {
          // Network error — keep trying unless timed out
        }

        // Schedule next tick — 2s between polls
        pollTimerRef.current = setTimeout(tick, 2000);
      };

      // First tick after a short delay to let the backend start
      pollTimerRef.current = setTimeout(tick, 1500);
    },
    [fetchData, onProductUpdated, stopPolling]
  );

  // Detect newly tracked product waiting for initial scrape
  useEffect(() => {
    const isPendingInitial =
      Boolean(product?.id) &&
      !product?.latestObservation &&
      (!product?.lastAttempt || product?.lastAttempt?.outcome !== 'failed');

    if (isPendingInitial && !pollTimerRef.current) {
      startPollLoop({ isWaitingForInitial: true, baselineObsCount: 0 });
    }
  }, [product?.id, product?.latestObservation, product?.lastAttempt, startPollLoop]);

  // Handle manual "Scrape now" trigger
  const handleScrapeNow = async () => {
    if (!product?.id) return;
    const baselineAttemptTime = attempts[0]?.started_at || product?.lastAttempt?.started_at || null;
    const baselineObsCount = observations.length;
    setIsScraping(true);

    try {
      await api.triggerManualScrape(product.id);
      startPollLoop({ baselineAttemptTime, baselineObsCount, isWaitingForInitial: false });
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
