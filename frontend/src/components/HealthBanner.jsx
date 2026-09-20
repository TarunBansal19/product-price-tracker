import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { formatTimestamp } from '../utils/formatters.js';

export function HealthBanner({ onStatusUpdate }) {
  const [health, setHealth] = useState(null);
  const [error, setError] = useState(null);

  const fetchHealth = async () => {
    try {
      const data = await api.getHealth();
      setHealth(data);
      setError(null);
      if (onStatusUpdate) onStatusUpdate(data);
    } catch (err) {
      setError(err.message);
      if (onStatusUpdate) onStatusUpdate(null);
    }
  };

  useEffect(() => {
    fetchHealth();
    const interval = setInterval(fetchHealth, 30000);
    return () => clearInterval(interval);
  }, []);

  if (error) {
    return (
      <div className="banner banner-error">
        <span>⚠️ <strong>Backend Unavailable:</strong> Could not connect to API server ({error}). Retrying...</span>
        <button className="btn btn-secondary btn-sm" onClick={fetchHealth}>Retry</button>
      </div>
    );
  }

  if (!health) return null;

  const isStale = health.db?.stale === true;
  const lastObs = health.db?.lastSuccessfulObservationAt
    ? formatTimestamp(health.db.lastSuccessfulObservationAt)
    : null;

  return (
    <>
      {isStale && (
        <div className="banner banner-stale">
          <div>
            <strong>⚠️ System Stale Warning:</strong> Dead-man's switch triggered. No successful price/stock observations have been recorded in over 3 hours!
            {lastObs && <span> Last success was at <span className="timestamp" title={lastObs.utc}>{lastObs.text}</span>.</span>}
          </div>
          <button className="btn btn-secondary btn-sm" onClick={fetchHealth}>Refresh</button>
        </div>
      )}
    </>
  );
}
