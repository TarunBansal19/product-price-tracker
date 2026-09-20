import React, { useState, useEffect } from 'react';
import { BackendStatus } from './components/BackendStatus.jsx';
import { subscribeWakeup } from './api.js';

export function App() {
  const [wakingUp, setWakingUp] = useState(false);
  const [wakeupMsg, setWakeupMsg] = useState('');
  const [trackedCount, setTrackedCount] = useState(0);
  const maxSlots = 15; // MAX_TRACKED from backend

  useEffect(() => {
    const unsub = subscribeWakeup((isWaking, msg) => {
      setWakingUp(isWaking);
      setWakeupMsg(msg);
    });
    return unsub;
  }, []);

  const handleHealthUpdate = (healthData) => {
    if (healthData && healthData.db && typeof healthData.db.activeTrackedCount === 'number') {
      setTrackedCount(healthData.db.activeTrackedCount);
    }
  };

  return (
    <div className="app-shell">
      {/* Left Rail (320px) */}
      <aside className="rail" aria-label="Sidebar">
        {/* Wordmark */}
        <div className="rail-wordmark">
          <svg
            width="28"
            height="28"
            viewBox="0 0 28 28"
            fill="none"
            className="rail-wordmark-logo"
            aria-hidden="true"
          >
            <path
              d="M6 5V23M11.5 5V23M17 5V23M22.5 5V23"
              stroke="#13232B"
              strokeWidth="2.4"
              strokeLinecap="round"
            />
            <path
              d="M3 20L26 8"
              stroke="#0E7C66"
              strokeWidth="2.4"
              strokeLinecap="round"
            />
          </svg>
          <span className="rail-wordmark-title">Tally</span>
        </div>

        {/* Search Field Shell */}
        <div className="rail-search-container">
          <div className="rail-search-box">
            <svg
              className="rail-search-icon"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              className="rail-search-input"
              placeholder="Search the store by name"
              aria-label="Search the store by name"
              readOnly
            />
          </div>
        </div>

        {/* Tracking Header */}
        <div className="rail-tracking-header">
          <span className="rail-tracking-title">Tracking</span>
          <span className="rail-tracking-slots">{trackedCount} of {maxSlots} slots</span>
        </div>

        {/* Tracked List Placeholder (Wired in Step 3) */}
        <div className="rail-tracked-list">
          {/* Will be populated with real tracked items */}
        </div>

        {/* Spacer */}
        <div className="rail-spacer" />

        {/* Backend Status at bottom wired to /api/health */}
        <BackendStatus onHealthUpdate={handleHealthUpdate} />
      </aside>

      {/* Main Workspace */}
      <main className="main-workspace" id="main-content">
        {wakingUp && (
          <div className="wakeup-banner" role="alert">
            <span>{wakeupMsg || 'Waking up the backend (free tier, up to ~1 min)...'}</span>
          </div>
        )}
        {/* Step 1 Shell Placeholder */}
      </main>
    </div>
  );
}

export default App;
