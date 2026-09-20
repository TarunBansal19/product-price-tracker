import React, { useState, useEffect } from 'react';
import { HealthBanner } from './components/HealthBanner.jsx';
import { TrackedList } from './components/TrackedList.jsx';
import { SearchTrack } from './components/SearchTrack.jsx';
import { ProductDetail } from './components/ProductDetail.jsx';
import { subscribeWakeup } from './api.js';

export function App() {
  const [currentTab, setCurrentTab] = useState('tracked'); // 'tracked' | 'search'
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [systemHealth, setSystemHealth] = useState(null);
  const [wakeupNotice, setWakeupNotice] = useState(null);

  useEffect(() => {
    const unsubscribe = subscribeWakeup((isWakingUp, message) => {
      setWakeupNotice(isWakingUp ? message : null);
    });
    return unsubscribe;
  }, []);

  const handleProductTracked = () => {
    setRefreshTrigger(prev => prev + 1);
  };

  const handleSelectProduct = (product) => {
    setSelectedProduct(product);
  };

  const handleBackFromDetail = () => {
    setSelectedProduct(null);
    setRefreshTrigger(prev => prev + 1);
  };

  const isHealthy = systemHealth?.status === 'healthy';
  const isDegraded = systemHealth?.status === 'degraded';

  return (
    <div>
      <header>
        <div className="header-content">
          <div className="header-title">
            <h1>
              INE Price Tracker
              <span className="badge">Assignment v1.0</span>
            </h1>
          </div>
          <div className="header-meta">
            <div>
              <span className={`status-dot ${isHealthy ? 'healthy' : isDegraded ? 'degraded' : 'offline'}`}></span>
              Backend: {systemHealth ? systemHealth.status : 'Connecting...'}
            </div>
            {systemHealth?.db?.activeTrackedCount !== undefined && (
              <div>
                Tracked: <strong>{systemHealth.db.activeTrackedCount}</strong> / 15
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="container">
        {wakeupNotice && (
          <div className="banner banner-wakeup">
            <span>⏳ <strong>Cold Start Notice:</strong> {wakeupNotice}</span>
          </div>
        )}

        <HealthBanner onStatusUpdate={setSystemHealth} />

        {selectedProduct ? (
          <ProductDetail
            product={selectedProduct}
            onBack={handleBackFromDetail}
          />
        ) : (
          <>
            <div className="tabs">
              <button
                className={`tab-btn ${currentTab === 'tracked' ? 'active' : ''}`}
                onClick={() => setCurrentTab('tracked')}
              >
                Tracked Products
              </button>
              <button
                className={`tab-btn ${currentTab === 'search' ? 'active' : ''}`}
                onClick={() => setCurrentTab('search')}
              >
                Search & Track Catalog
              </button>
            </div>

            {currentTab === 'tracked' && (
              <TrackedList
                onSelectProduct={handleSelectProduct}
                onRefreshNeeded={refreshTrigger}
              />
            )}

            {currentTab === 'search' && (
              <SearchTrack
                onProductTracked={handleProductTracked}
              />
            )}
          </>
        )}
      </main>
    </div>
  );
}
export default App;
