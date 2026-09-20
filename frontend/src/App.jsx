import React, { useState, useEffect, useCallback } from 'react';
import { BackendStatus } from './components/BackendStatus.jsx';
import { SearchAutocomplete } from './components/SearchAutocomplete.jsx';
import { TrackedRow } from './components/TrackedRow.jsx';
import { EmptyState } from './components/EmptyState.jsx';
import { ProductDetail } from './components/ProductDetail.jsx';
import { ThemeToggle } from './components/ThemeToggle.jsx';
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
    const interval = setInterval(() => {
      fetchTrackedProducts();
    }, 15000);
    return () => clearInterval(interval);
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

  const handleUntrack = (untrackedId) => {
    const idToMatch = String(untrackedId || selectedProductId);
    setTrackedProducts((prev) =>
      prev.filter((p) => p.id !== idToMatch && String(p.store_product_id) !== idToMatch)
    );
    setSelectedProductId(null);
    fetchTrackedProducts();
  };

  const trackedStoreIds = new Set(
    trackedProducts.map((p) => String(p.store_product_id))
  );

  const [theme, setTheme] = useState(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem('tally-theme') : null;
    if (saved) return saved;
    return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem('tally-theme', theme);
    } catch {
      // localStorage may be unavailable
    }
  }, [theme]);

  const toggleTheme = () => {
    setTheme((t) => (t === 'light' ? 'dark' : 'light'));
  };

  const selectedProduct = trackedProducts.find(
    (p) => p.id === selectedProductId || String(p.store_product_id) === String(selectedProductId)
  );

  return (
    <div className="app-shell">
      {/* Left Rail (320px) */}
      <aside className="rail" aria-label="Sidebar">
        {/* Rail Top Header: Wordmark + Dark Mode Toggle */}
        <div className="rail-header-top">
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
                stroke="var(--ink)"
                strokeWidth="2.4"
                strokeLinecap="round"
              />
              <path
                d="M3 20L26 8"
                stroke="var(--live)"
                strokeWidth="2.4"
                strokeLinecap="round"
              />
            </svg>
            <span className="rail-wordmark-title">Tally</span>
          </div>

          <ThemeToggle theme={theme} onToggle={toggleTheme} />
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

        {/* Tracked List (Section 3.1) */}
        <div className="rail-tracked-list" role="list">
          {trackedProducts.map((product) => (
            <TrackedRow
              key={product.id}
              product={product}
              isSelected={selectedProduct?.id === product.id}
              onSelect={(p) => setSelectedProductId(p.id)}
            />
          ))}
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

        {!selectedProduct ? (
          <EmptyState />
        ) : (
          <ProductDetail
            product={selectedProduct}
            onProductUpdated={fetchTrackedProducts}
            onUntrack={handleUntrack}
          />
        )}
      </main>
    </div>
  );
}

export default App;
