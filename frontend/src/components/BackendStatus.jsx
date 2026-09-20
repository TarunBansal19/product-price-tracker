import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { formatDistanceToNow, getNextRunText } from '../utils/formatters.js';

export function BackendStatus({ onHealthUpdate }) {
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [nextRun, setNextRun] = useState('');

  const fetchHealth = async () => {
    try {
      const data = await api.getHealth();
      setHealth(data);
      setError(null);
      setNextRun(getNextRunText(data?.db?.lastRun?.started_at));
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
    const interval = setInterval(fetchHealth, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const updateCountdown = () => {
      setNextRun(getNextRunText(health?.db?.lastRun?.started_at));
    };
    updateCountdown();
    const timer = setInterval(updateCountdown, 30000);
    return () => clearInterval(timer);
  }, [health]);

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

