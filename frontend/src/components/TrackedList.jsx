import React, { useState, useEffect } from 'react';
import { api } from '../api.js';
import { formatPrice, formatStock, formatTimestamp } from '../utils/formatters.js';

export function TrackedList({ onSelectProduct, onRefreshNeeded }) {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [scrapingId, setScrapingId] = useState(null);
  const [actionMessage, setActionMessage] = useState(null);

  const fetchTracked = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getTrackedProducts();
      setProducts(data.products || []);
    } catch (err) {
      setError({
        code: err.code || 'FETCH_FAILED',
        message: err.message
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTracked();
  }, [onRefreshNeeded]);

  const handleManualScrape = async (product) => {
    setScrapingId(product.id);
    setActionMessage(null);
    try {
      await api.triggerManualScrape(product.id);
      setActionMessage({
        type: 'success',
        text: `Manual scrape initiated in background for "${product.name}". Refresh in a few seconds to see updated history.`
      });
      // Refresh after a brief delay
      setTimeout(fetchTracked, 4000);
    } catch (err) {
      setActionMessage({
        type: 'error',
        text: `Manual scrape failed: [${err.code || 'ERROR'}] ${err.message}`
      });
    } finally {
      setScrapingId(null);
    }
  };

  const handleUntrack = async (product) => {
    if (!window.confirm(`Are you sure you want to stop tracking "${product.name}"? Historical scrape data will be preserved.`)) {
      return;
    }
    setActionMessage(null);
    try {
      await api.untrackProduct(product.id);
      setActionMessage({
        type: 'info',
        text: `Tracking stopped for "${product.name}".`
      });
      fetchTracked();
    } catch (err) {
      setActionMessage({
        type: 'error',
        text: `Untrack failed: [${err.code || 'ERROR'}] ${err.message}`
      });
    }
  };

  return (
    <div className="card">
      <div className="card-title">
        <span>Active Tracked Products</span>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <button className="btn btn-secondary btn-sm" onClick={fetchTracked} disabled={loading}>
            {loading ? 'Refreshing...' : '↻ Refresh'}
          </button>
        </div>
      </div>

      {actionMessage && (
        <div className={`banner ${actionMessage.type === 'error' ? 'banner-error' : 'banner-stale'}`}
             style={actionMessage.type === 'success' ? { backgroundColor: 'var(--success-bg)', borderColor: '#86efac', color: '#166534' } : {}}>
          <span>{actionMessage.text}</span>
          <button className="btn btn-secondary btn-sm" onClick={() => setActionMessage(null)}>Dismiss</button>
        </div>
      )}

      {error && (
        <div className="banner banner-error">
          <span>⚠️ <strong>Error [{error.code}]:</strong> {error.message}</span>
        </div>
      )}

      {loading && products.length === 0 ? (
        <div className="state-empty">
          <div className="loading-spinner"></div>
          <p style={{ marginTop: '1rem' }}>Loading tracked products...</p>
        </div>
      ) : products.length === 0 ? (
        <div className="state-empty">
          <p>No products currently tracked.</p>
          <small>Go to <strong>Search & Track</strong> to add items from the store catalog.</small>
        </div>
      ) : (
        <div className="table-responsive">
          <table>
            <thead>
              <tr>
                <th style={{ width: '80px' }}>Store ID</th>
                <th>Product Name</th>
                <th>Category</th>
                <th>Latest Price</th>
                <th>Stock Status</th>
                <th>Last Scrape</th>
                <th>Last Success</th>
                <th style={{ textAlign: 'right', minWidth: '180px' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => {
                const obs = p.latest_observation;
                const lastAttempt = p.last_attempt;
                const lastSuccessFormatted = formatTimestamp(p.last_success_at);

                return (
                  <tr key={p.id}>
                    <td className="cell-mono">#{p.store_product_id}</td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{p.name}</div>
                      {p.consecutive_failed_jobs > 0 && (
                        <div style={{ color: 'var(--danger)', fontSize: '0.75rem', fontWeight: 500 }}>
                          ⚠️ {p.consecutive_failed_jobs} consecutive job failure{p.consecutive_failed_jobs > 1 ? 's' : ''}
                        </div>
                      )}
                    </td>
                    <td>{p.category || '—'}</td>
                    <td>
                      {obs ? (
                        <div>
                          <strong style={{ fontSize: '0.95rem' }}>
                            {formatPrice(obs.price_minor, obs.currency)}
                          </strong>
                          {obs.cross_checked && (
                            <span title="Authoritative quote cross-checked with DOM" style={{ color: 'var(--success)', marginLeft: '0.35rem', cursor: 'help' }}>
                              ✓
                            </span>
                          )}
                        </div>
                      ) : (
                        <span style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontSize: '0.8rem' }}>
                          No observations yet — first scrape pending
                        </span>
                      )}
                    </td>
                    <td>
                      {obs ? (
                        <span className={`badge-status ${obs.stock_state}`}>
                          {formatStock(obs.stock_state, obs.stock_quantity)}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--text-muted)' }}>—</span>
                      )}
                    </td>
                    <td>
                      {lastAttempt ? (
                        <span className={`badge-status ${lastAttempt.outcome || 'retried'}`}>
                          {lastAttempt.outcome || 'in_flight'}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>Pending</span>
                      )}
                    </td>
                    <td>
                      <span className="timestamp" title={lastSuccessFormatted.utc}>
                        {lastSuccessFormatted.text}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', gap: '0.35rem' }}>
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => onSelectProduct(p)}
                        >
                          Details & Log
                        </button>
                        <button
                          className="btn btn-secondary btn-sm"
                          disabled={scrapingId === p.id}
                          onClick={() => handleManualScrape(p)}
                          title="Trigger immediate scrape on-demand"
                        >
                          {scrapingId === p.id ? 'Scraping...' : '⚡ Scrape'}
                        </button>
                        <button
                          className="btn btn-danger btn-sm"
                          onClick={() => handleUntrack(p)}
                          title="Stop tracking this product"
                        >
                          Untrack
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
