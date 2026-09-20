import React from 'react';

/**
 * Sparkline component matching Section 3.1:
 * 64x18, 1.5px stroke, round joins; --ink when selected, --muted otherwise.
 * Hidden if fewer than 2 observations exist.
 */
export function Sparkline({ observations = [], isSelected = false }) {
  if (!observations || observations.length < 2) {
    return null;
  }

  // Filter observations to last 7 days per spec
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const filtered = observations.filter(
    (o) => new Date(o.observed_at).getTime() >= sevenDaysAgo
  );

  const pointsData = filtered.length >= 2 ? filtered : observations;
  if (pointsData.length < 2) {
    return null;
  }

  const sorted = [...pointsData].sort(
    (a, b) => new Date(a.observed_at).getTime() - new Date(b.observed_at).getTime()
  );

  const prices = sorted.map((o) => Number(o.price_minor));
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);

  const width = 64;
  const height = 18;
  const paddingY = 2;
  const effectiveHeight = height - paddingY * 2;

  const points = sorted.map((obs, idx) => {
    const x = (idx / (sorted.length - 1)) * width;
    let y = height / 2;
    if (maxPrice > minPrice) {
      // Invert: higher price is closer to top (y = paddingY)
      y = height - paddingY - ((Number(obs.price_minor) - minPrice) / (maxPrice - minPrice)) * effectiveHeight;
    }
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const pathD = `M ${points.join(' L ')}`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      fill="none"
      className="sparkline-svg"
      aria-hidden="true"
    >
      <path
        d={pathD}
        stroke={isSelected ? 'var(--ink)' : 'var(--muted)'}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
