import React from 'react';

export function EmptyState() {
  return (
    <div className="empty-state">
      {/* 26 small dashed hollow bars (4x14, radius 1, 1px dashed #B4BFBC, 7px gaps) */}
      <div className="empty-state-motif" aria-hidden="true">
        {Array.from({ length: 26 }).map((_, index) => (
          <div key={index} className="empty-state-bar" />
        ))}
      </div>

      <h1 className="empty-state-title">Pick a product to watch</h1>

      <p className="empty-state-body">
        Search the store on the left. Once you track a product, Tally checks its price
        and stock every 2 hours and keeps every attempt in a log, including the ones
        that fail.
      </p>

      <p className="empty-state-hint">
        The first check runs right after you start tracking.
      </p>
    </div>
  );
}
