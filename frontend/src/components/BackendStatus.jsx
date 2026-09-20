import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { formatDistanceToNow, getNextRunText } from '../utils/formatters.js';

export function BackendStatus({ onHealthUpdate }) {
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [nextRun, setNextRun] = useState(getNextRunText());

  const fetchHealth = async () => {
    try {
      const data = await api.getHealth();
      setHealth(data);
      setError(null);
      if (onHealthUpdate) {
        onHealthUpdate(data);
      }
    } catch (err) {
      setError(err);
      if (onHealthUpdate) {
        onHealthUpdate(null);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHealth();
    // Poll health every 30 seconds
    const interval = setInterval(fetchHealth, 30000);
    // Update next run text every minute
    const timer = setInterval(() => {
      setNextRun(getNextRunText());
    }, 60000);

    return () => {
      clearInterval(interval);
      clearInterval(timer);
    };
  }, []);

  let dotClass = 'healthy';
  let statusText = 'Backend healthy';

  if (error || (health && !health.db?.connected)) {
    dotClass = 'unreachable';
    statusText = 'Backend not reachable';
  } else if (health?.db?.stale) {
    dotClass = 'stale';
    statusText = 'No successful run in over 3 hours';
  } else if (health?.status === 'degraded') {
    dotClass = 'degraded';
    statusText = 'Backend degraded';
  }

  const lastRunTime = health?.db?.lastRun?.started_at;
  const lastRunText = lastRunTime ? `Last run ${formatDistanceToNow(lastRunTime)}` : 'No scrape runs yet';

  return (
    <div className="backend-status-block" role="status" aria-live="polite">
      <div className="backend-status-line1">
        <span className={`backend-status-dot ${dotClass}`} />
        <span>{statusText}</span>
      </div>
      <div className="backend-status-line2">
        <span>{lastRunText}</span>
        <span>{nextRun}</span>
      </div>
      <div className="backend-status-line3">
        Scrapes run every 2 hours
      </div>
    </div>
  );
}
