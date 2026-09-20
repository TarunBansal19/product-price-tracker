import React, { useState, useEffect, useRef, useMemo } from 'react';
import { formatPrice, formatStock, formatTimestamp } from '../utils/formatters.js';

export function ChartSection({
  productId,
  observations = [],
  attempts = [],
  selectedRange = '7d',
  onRangeChange
}) {
  const [view, setView] = useState('chart'); // 'chart' | 'table'
  const [containerWidth, setContainerWidth] = useState(1024);
  const [hoverIndex, setHoverIndex] = useState(null);
  const containerRef = useRef(null);

  // ResizeObserver for responsive SVG
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width > 0) {
          setContainerWidth(Math.floor(entry.contentRect.width));
        }
      }
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // Compute High / Low summary text
  const highLowSummary = useMemo(() => {
    if (!observations || observations.length === 0) {
      return 'No observations recorded in this range.';
    }

    let minObs = observations[0];
    let maxObs = observations[0];

    for (const obs of observations) {
      if (Number(obs.price_minor) < Number(minObs.price_minor)) minObs = obs;
      if (Number(obs.price_minor) > Number(maxObs.price_minor)) maxObs = obs;
    }

    const minDate = new Date(minObs.observed_at).toLocaleDateString('en-US', {
      timeZone: 'Asia/Kolkata',
      month: 'short',
      day: 'numeric'
    });
    const maxDate = new Date(maxObs.observed_at).toLocaleDateString('en-US', {
      timeZone: 'Asia/Kolkata',
      month: 'short',
      day: 'numeric'
    });

    const minPriceStr = formatPrice(minObs.price_minor, minObs.currency, false);
    const maxPriceStr = formatPrice(maxObs.price_minor, maxObs.currency, false);

    return `Low ${minPriceStr} on ${minDate}. High ${maxPriceStr} on ${maxDate}.`;
  }, [observations]);

  // Group attempts by run_id to build the Scrape Run Strip per Section 4
  const slotRuns = useMemo(() => {
    if (!attempts || attempts.length === 0) return [];

    const runsMap = new Map();
    // Group attempts by run_id
    for (const att of attempts) {
      if (!runsMap.has(att.run_id)) {
        runsMap.set(att.run_id, []);
      }
      runsMap.get(att.run_id).push(att);
    }

    const slots = [];
    for (const [runId, attList] of runsMap.entries()) {
      // Sort attempts ascending by attempt_number
      attList.sort((a, b) => a.attempt_number - b.attempt_number);
      const finalAttempt = attList[attList.length - 1];
      const maxAttemptNumber = Math.max(...attList.map((a) => a.attempt_number));

      // Slot timestamp: scheduled_slot or started_at of first attempt
      const slotTime = finalAttempt.scheduled_slot || attList[0].started_at;

      let runType = 'failed';
      if (finalAttempt.outcome === 'success') {
        runType = finalAttempt.attempt_number === 1 ? 'first_try' : 'retry_success';
      }

      slots.push({
        runId,
        time: new Date(slotTime).getTime(),
        timeIso: slotTime,
        runType,
        finalAttempt,
        totalAttempts: maxAttemptNumber,
        observation: finalAttempt.observation
      });
    }

    // Sort ascending by time
    slots.sort((a, b) => a.time - b.time);
    return slots;
  }, [attempts]);

  // Time bounds
  const { startTime, endTime } = useMemo(() => {
    const now = Date.now();
    let start = now - 7 * 24 * 60 * 60 * 1000;
    if (selectedRange === '24h') start = now - 24 * 60 * 60 * 1000;
    else if (selectedRange === '7d') start = now - 7 * 24 * 60 * 60 * 1000;
    else if (selectedRange === '30d') start = now - 30 * 24 * 60 * 60 * 1000;
    else if (selectedRange === 'all') {
      if (observations.length > 0) {
        const firstObsTime = new Date(observations[0].observed_at).getTime();
        start = Math.min(firstObsTime, now - 24 * 3600 * 1000);
      } else {
        start = now - 7 * 24 * 60 * 60 * 1000;
      }
    }
    return { startTime: start, endTime: now };
  }, [selectedRange, observations]);

  // Dimensions & Scales
  const plotWidth = containerWidth;
  const xStart = 88;
  const xEnd = Math.max(xStart + 100, plotWidth - 16);
  const plotInnerWidth = xEnd - xStart;

  const getX = (t) => {
    if (endTime <= startTime) return xStart;
    const ratio = Math.max(0, Math.min(1, (t - startTime) / (endTime - startTime)));
    return xStart + ratio * plotInnerWidth;
  };

  // Y Price Scale
  const { yTicks, getY, minBound, maxBound } = useMemo(() => {
    const yTop = 24;
    const yBottom = 200;

    if (!observations || observations.length === 0) {
      const defaultTicks = [10000, 12000, 14000, 16000, 18000];
      return {
        yTicks: defaultTicks.map((val) => ({ val, y: 112 })),
        getY: () => 112,
        minBound: 10000,
        maxBound: 18000
      };
    }

    const prices = observations.map((o) => Number(o.price_minor) / 100);
    const minP = Math.min(...prices);
    const maxP = Math.max(...prices);
    const span = Math.max(100, maxP - minP);

    // Compute nice round bounds
    const step = Math.max(100, Math.ceil(span / 4 / 100) * 100);
    const low = Math.max(0, Math.floor(minP / step) * step);
    const high = Math.ceil(maxP / step) * step;

    const ticks = [];
    const numSteps = Math.max(1, Math.round((high - low) / step));
    for (let i = 0; i <= numSteps; i++) {
      const val = low + i * step;
      const y = yBottom - ((val - low) / (high - low || 1)) * (yBottom - yTop);
      ticks.push({ val, y });
    }

    const calcY = (priceMajor) => {
      if (high <= low) return (yTop + yBottom) / 2;
      return yBottom - ((priceMajor - low) / (high - low)) * (yBottom - yTop);
    };

    return { yTicks: ticks, getY: calcY, minBound: low, maxBound: high };
  }, [observations]);

  // Sorted observations for price line
  const sortedObs = useMemo(() => {
    return [...observations].sort(
      (a, b) => new Date(a.observed_at).getTime() - new Date(b.observed_at).getTime()
    );
  }, [observations]);

  // Build price line segments (solid between consecutive checks, dashed across gaps/failures)
  const priceSegments = useMemo(() => {
    if (sortedObs.length === 0) return [];
    const segments = [];
    const maxConsecutiveGapMs = 3.5 * 3600 * 1000; // > 3.5 hours means a missed or failed slot

    let currentSolidChunk = [sortedObs[0]];

    for (let i = 1; i < sortedObs.length; i++) {
      const prev = sortedObs[i - 1];
      const curr = sortedObs[i];
      const prevTime = new Date(prev.observed_at).getTime();
      const currTime = new Date(curr.observed_at).getTime();

      if (currTime - prevTime > maxConsecutiveGapMs) {
        // Gap detected! Push solid chunk
        if (currentSolidChunk.length > 0) {
          segments.push({ type: 'solid', points: currentSolidChunk });
          currentSolidChunk = [curr];
        }
        // Push dashed bridge segment between prev and curr
        segments.push({ type: 'dashed', points: [prev, curr] });
      } else {
        currentSolidChunk.push(curr);
      }
    }

    if (currentSolidChunk.length > 0) {
      segments.push({ type: 'solid', points: currentSolidChunk });
    }

    return segments;
  }, [sortedObs]);

  // Midnights for Day Ticks
  const dayTicks = useMemo(() => {
    const ticks = [];
    const curr = new Date(startTime);
    curr.setHours(0, 0, 0, 0);
    // advance to next midnight
    curr.setDate(curr.getDate() + 1);

    while (curr.getTime() <= endTime) {
      const t = curr.getTime();
      const x = getX(t);
      if (x >= xStart && x <= xEnd) {
        const label = curr.toLocaleDateString('en-US', {
          timeZone: 'Asia/Kolkata',
          month: 'short',
          day: 'numeric'
        });
        ticks.push({ time: t, x, label });
      }
      curr.setDate(curr.getDate() + 1);
    }
    return ticks;
  }, [startTime, endTime, xStart, xEnd, getX]);

  // Stock Band Segments (y=226, height 24, radius 3)
  const stockBandSegments = useMemo(() => {
    if (sortedObs.length === 0) return [];
    const segments = [];

    let curState = sortedObs[0].stock_state;
    let segStart = new Date(sortedObs[0].observed_at).getTime();
    let lastObsTime = segStart;

    const stockColor = (state) => {
      if (state === 'in_stock') return 'var(--stock-in)';
      if (state === 'low_stock') return 'var(--stock-low)';
      if (state === 'out_of_stock') return 'var(--stock-out)';
      return 'var(--stock-in)';
    };

    for (let i = 1; i < sortedObs.length; i++) {
      const obs = sortedObs[i];
      const obsTime = new Date(obs.observed_at).getTime();

      if (obs.stock_state !== curState) {
        segments.push({
          state: curState,
          color: stockColor(curState),
          startTime: segStart,
          endTime: obsTime
        });
        curState = obs.stock_state;
        segStart = obsTime;
      }
      lastObsTime = obsTime;
    }

    segments.push({
      state: curState,
      color: stockColor(curState),
      startTime: segStart,
      endTime: lastObsTime
    });

    return segments;
  }, [sortedObs]);

  // Slot Strip Runs in Range
  const visibleSlots = useMemo(() => {
    return slotRuns.filter((s) => s.time >= startTime && s.time <= endTime);
  }, [slotRuns, startTime, endTime]);

  // Hover target
  const activeHover = useMemo(() => {
    if (hoverIndex === null || hoverIndex < 0) return null;
    if (hoverIndex < visibleSlots.length) {
      const slot = visibleSlots[hoverIndex];
      const x = getX(slot.time);

      // Find closest observation for price
      let closestObs = null;
      let minDiff = Infinity;
      for (const obs of sortedObs) {
        const diff = Math.abs(new Date(obs.observed_at).getTime() - slot.time);
        if (diff < minDiff) {
          minDiff = diff;
          closestObs = obs;
        }
      }

      return {
        slot,
        x,
        obs: closestObs,
        y: closestObs ? getY(Number(closestObs.price_minor) / 100) : 112
      };
    }
    return null;
  }, [hoverIndex, visibleSlots, sortedObs, getX, getY]);

  const handleKeyDown = (e) => {
    if (visibleSlots.length === 0) return;
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      setHoverIndex((prev) =>
        prev === null || prev >= visibleSlots.length - 1 ? 0 : prev + 1
      );
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      setHoverIndex((prev) =>
        prev === null || prev <= 0 ? visibleSlots.length - 1 : prev - 1
      );
    } else if (e.key === 'Escape') {
      setHoverIndex(null);
    }
  };

  const handleMouseMove = (e) => {
    if (!containerRef.current || visibleSlots.length === 0) return;
    const rect = containerRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;

    let closestIdx = -1;
    let closestDist = Infinity;

    visibleSlots.forEach((slot, idx) => {
      const sx = getX(slot.time);
      const dist = Math.abs(mouseX - sx);
      if (dist < closestDist) {
        closestDist = dist;
        closestIdx = idx;
      }
    });

    if (closestDist < 30) {
      setHoverIndex(closestIdx);
    } else {
      setHoverIndex(null);
    }
  };

  return (
    <section className="chart-section" aria-labelledby="chart-section-title">
      {/* Header Row */}
      <div className="chart-header-row">
        <div className="chart-title-block">
          <h2 id="chart-section-title" className="chart-title">
            Price, stock and scrape runs
          </h2>
          <span className="chart-subtitle">{highLowSummary}</span>
        </div>

        <div className="chart-controls-row">
          {/* Range Segmented Control */}
          <div className="segmented-control" role="tablist" aria-label="Time range">
            {['24h', '7d', '30d', 'all'].map((rangeKey) => {
              const labelMap = {
                '24h': '24 hours',
                '7d': '7 days',
                '30d': '30 days',
                all: 'All'
              };
              return (
                <button
                  key={rangeKey}
                  type="button"
                  role="tab"
                  aria-selected={selectedRange === rangeKey}
                  className={`segmented-option ${
                    selectedRange === rangeKey ? 'active' : ''
                  }`}
                  onClick={() => onRangeChange && onRangeChange(rangeKey)}
                >
                  {labelMap[rangeKey]}
                </button>
              );
            })}
          </div>

          {/* View Segmented Control */}
          <div className="segmented-control" role="tablist" aria-label="View mode">
            <button
              type="button"
              role="tab"
              aria-selected={view === 'chart'}
              className={`segmented-option ${view === 'chart' ? 'active' : ''}`}
              onClick={() => setView('chart')}
            >
              Chart
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === 'table'}
              className={`segmented-option ${view === 'table' ? 'active' : ''}`}
              onClick={() => setView('table')}
            >
              Table
            </button>
          </div>
        </div>
      </div>

      {view === 'table' ? (
        /* Table View */
        <div className="scrape-log-table-wrapper" style={{ marginTop: '16px' }}>
          <table className="scrape-log-table">
            <thead>
              <tr>
                <th className="col-time">Time</th>
                <th>Price</th>
                <th>Stock</th>
              </tr>
            </thead>
            <tbody>
              {sortedObs.slice().reverse().map((obs) => {
                const ts = formatTimestamp(obs.observed_at);
                const priceText = formatPrice(obs.price_minor, obs.currency, true);
                const stockText = formatStock(obs.stock_state, obs.stock_quantity);
                return (
                  <tr key={obs.id}>
                    <td className="col-time">
                      <span title={ts.utc}>{ts.text}</span>
                    </td>
                    <td style={{ fontWeight: 600 }}>{priceText}</td>
                    <td>{stockText}</td>
                  </tr>
                );
              })}
              {sortedObs.length === 0 && (
                <tr>
                  <td colSpan={3} style={{ padding: '24px 0', color: 'var(--slate)' }}>
                    No observation rows in this range.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        /* Chart View */
        <div
          className="chart-svg-container"
          ref={containerRef}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHoverIndex(null)}
          onKeyDown={handleKeyDown}
          tabIndex={0}
          role="region"
          aria-label="Interactive price chart. Use left and right arrow keys to navigate slots."
          style={{
            position: 'relative',
            width: '100%',
            height: '320px',
            marginTop: '16px',
            outline: 'none'
          }}
        >
          <svg
            width="100%"
            height="320"
            viewBox={`0 0 ${containerWidth} 320`}
            style={{ display: 'block', overflow: 'visible' }}
          >
            {/* 1. Gridlines & Y-Labels */}
            {yTicks.map(({ val, y }, idx) => (
              <g key={idx}>
                <line
                  x1={xStart}
                  y1={y}
                  x2={xEnd}
                  y2={y}
                  stroke="var(--grid)"
                  strokeWidth="1"
                />
                <text
                  x={74}
                  y={y + 4}
                  textAnchor="end"
                  fill="var(--slate)"
                  fontSize="12"
                  fontFamily="var(--font-body)"
                  className="tabular-nums"
                >
                  ₹{val.toLocaleString('en-IN')}
                </text>
              </g>
            ))}

            {/* 2. Stock Band */}
            <text
              x={0}
              y={242}
              fill="var(--slate)"
              fontSize="12"
              fontFamily="var(--font-body)"
            >
              Stock
            </text>

            {/* Stock Band Background / Gaps */}
            <rect
              x={xStart}
              y={226}
              width={plotInnerWidth}
              height={24}
              rx={3}
              fill="none"
              stroke="var(--chart-unknown-stroke)"
              strokeWidth="1"
              strokeDasharray="3 3"
            />

            {/* Filled Stock Band Segments */}
            {stockBandSegments.map((seg, idx) => {
              const x1 = Math.max(xStart, getX(seg.startTime));
              const x2 = Math.min(xEnd, getX(seg.endTime));
              const w = Math.max(4, x2 - x1);
              return (
                <rect
                  key={idx}
                  x={x1}
                  y={226}
                  width={w}
                  height={24}
                  rx={3}
                  fill={seg.color}
                />
              );
            })}

            {/* 3. Scrape Strip */}
            <text
              x={0}
              y={281}
              fill="var(--slate)"
              fontSize="12"
              fontFamily="var(--font-body)"
            >
              Scrape runs
            </text>

            {visibleSlots.map((slot, idx) => {
              const x = getX(slot.time);
              const barX = x - 2;

              if (slot.runType === 'first_try') {
                return (
                  <rect
                    key={slot.runId || idx}
                    x={barX}
                    y={270}
                    width={4}
                    height={14}
                    rx={1}
                    fill="var(--live)"
                  />
                );
              }

              if (slot.runType === 'retry_success') {
                return (
                  <g key={slot.runId || idx}>
                    <circle cx={x} cy={264.3} r={1.7} fill="var(--amber)" />
                    <rect
                      x={barX}
                      y={270}
                      width={4}
                      height={14}
                      rx={1}
                      fill="var(--amber)"
                    />
                  </g>
                );
              }

              // Failed
              return (
                <rect
                  key={slot.runId || idx}
                  x={barX}
                  y={270}
                  width={4}
                  height={14}
                  rx={1}
                  fill="none"
                  stroke="var(--red)"
                  strokeWidth="1.4"
                />
              );
            })}

            {/* 4. Day Ticks */}
            {dayTicks.map((dt, idx) => (
              <g key={idx}>
                <line
                  x1={dt.x}
                  y1={292}
                  x2={dt.x}
                  y2={297}
                  stroke="var(--day-ticks)"
                  strokeWidth="1"
                />
                <text
                  x={dt.x}
                  y={310}
                  textAnchor="middle"
                  fill="var(--slate)"
                  fontSize="12"
                  fontFamily="var(--font-body)"
                >
                  {dt.label}
                </text>
              </g>
            ))}

            {/* 6. Price Line Segments */}
            {priceSegments.map((seg, sIdx) => {
              const pts = seg.points.map((obs) => {
                const px = getX(new Date(obs.observed_at).getTime());
                const py = getY(Number(obs.price_minor) / 100);
                return `${px.toFixed(1)},${py.toFixed(1)}`;
              });
              const pathD = `M ${pts.join(' L ')}`;

              return (
                <path
                  key={sIdx}
                  d={pathD}
                  fill="none"
                  stroke="var(--ink)"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeDasharray={seg.type === 'dashed' ? '4 5' : undefined}
                />
              );
            })}

            {/* End Dot on latest observation */}
            {sortedObs.length > 0 && (
              <circle
                cx={getX(new Date(sortedObs[sortedObs.length - 1].observed_at).getTime())}
                cy={getY(Number(sortedObs[sortedObs.length - 1].price_minor) / 100)}
                r="4.5"
                fill="var(--ink)"
              />
            )}

            {/* 5. Hover Guide */}
            {activeHover && (
              <g>
                <line
                  x1={activeHover.x}
                  y1={16}
                  x2={activeHover.x}
                  y2={286}
                  stroke="var(--ink)"
                  strokeOpacity="0.35"
                  strokeDasharray="3 3"
                />
                {activeHover.obs && (
                  <circle
                    cx={activeHover.x}
                    cy={activeHover.y}
                    r="5.5"
                    fill="#FFFFFF"
                    stroke="var(--ink)"
                    strokeWidth="2"
                  />
                )}
              </g>
            )}
          </svg>

          {/* 7. Tooltip HTML Overlay */}
          {activeHover && (
            <div
              className="chart-tooltip"
              style={{
                position: 'absolute',
                top: Math.max(10, Math.min(180, activeHover.y - 30)),
                left:
                  activeHover.x > 260
                    ? `${activeHover.x - 220}px`
                    : `${activeHover.x + 20}px`,
                width: '200px',
                pointerEvents: 'none',
                zIndex: 40
              }}
            >
              <div className="chart-tooltip-time">
                {formatTimestamp(activeHover.slot.timeIso).text}
              </div>
              <div className="chart-tooltip-price">
                {activeHover.obs
                  ? formatPrice(activeHover.obs.price_minor, activeHover.obs.currency, true)
                  : 'No price saved'}
              </div>
              <div className="chart-tooltip-stock">
                {activeHover.obs
                  ? formatStock(activeHover.obs.stock_state, activeHover.obs.stock_quantity)
                  : 'No stock data'}
              </div>
              <div className="chart-tooltip-outcome">
                {activeHover.slot.runType === 'first_try'
                  ? 'Succeeded on first try'
                  : activeHover.slot.runType === 'retry_success'
                  ? `Succeeded on attempt ${activeHover.slot.totalAttempts} of 4`
                  : `Failed after ${activeHover.slot.totalAttempts} attempts. Nothing saved.`}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Legend under the plot */}
      {view === 'chart' && (
        <div className="chart-legend" aria-hidden="true">
          <div className="legend-item">
            <span className="legend-swatch first-try" />
            <span>Succeeded on first try</span>
          </div>
          <div className="legend-item">
            <span className="legend-swatch retry-success">
              <span className="legend-dot" />
            </span>
            <span>Succeeded after a retry</span>
          </div>
          <div className="legend-item">
            <span className="legend-swatch failed" />
            <span>Failed, nothing saved</span>
          </div>
          <div className="legend-item">
            <span className="legend-dashed-line" />
            <span>Dashed line: no price saved for that check</span>
          </div>
        </div>
      )}
    </section>
  );
}
