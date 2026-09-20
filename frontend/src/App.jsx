import React, { useState, useEffect, useCallback } from 'react';
import { BackendStatus } from './components/BackendStatus.jsx';
import { SearchAutocomplete } from './components/SearchAutocomplete.jsx';
import { EmptyState } from './components/EmptyState.jsx';
import { api, subscribeWakeup } from './api.js';

export function App() {
  const [wakingUp, setWakingUp] = useState(false);
  const [wakeupMsg, setWakeupMsg] = useState('');
  const [trackedProducts, setTrackedProducts] = useState([]);
  const [selectedProductId, setSelectedProductId] = useState(null);
  const maxSlots = 15; // MAX_TRACKED from backend

  useEffect(() => {
    const unsub = subscribeWakeup((isWaking, msg) => {
      setWakingUp(isWaking);
      setWakeupMsg(msg);
    });
    return unsub;
  }, []);

  const fetchTrackedProducts = useCallback(async () => {
    try {
      const data = await api.getTrackedProducts();
      setTrackedProducts(data.products || []);
    } catch (err) {
      console.error('Failed to load tracked products:', err);
    }
  }, []);

  useEffect(() => {
    fetchTrackedProducts();
  }, [fetchTrackedProducts]);

  const handleProductTracked = async (newProduct) => {
    await fetchTrackedProducts();
    if (newProduct && (newProduct.id || newProduct.store_product_id)) {
      setSelectedProductId(newProduct.id || newProduct.store_product_id);
    }
  };

  const handleHealthUpdate = (healthData) => {
    // Optionally refresh tracked count if health updates
  };

  const trackedStoreIds = new Set(
    trackedProducts.map((p) => String(p.store_product_id))
  );

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

        {/* Search Field & Dropdown (Section 6) */}
        <SearchAutocomplete
          trackedProductIds={trackedStoreIds}
          onProductTracked={handleProductTracked}
        />

        {/* Tracking Header */}
        <div className="rail-tracking-header">
          <span className="rail-tracking-title">Tracking</span>
          <span className="rail-tracking-slots">
            {trackedProducts.length} of {maxSlots} slots
          </span>
        </div>

        {/* Tracked List (will be populated in Step 3) */}
        <div className="rail-tracked-list">
          {/* Populated in Step 3 */}
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

        {!selectedProductId ? (
          <EmptyState />
        ) : (
          <div className="product-detail-placeholder">
            {/* Will be implemented in Step 4 */}
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
