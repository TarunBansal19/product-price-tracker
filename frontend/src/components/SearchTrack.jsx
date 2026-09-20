import React, { useState, useEffect } from 'react';
import { api } from '../api.js';

export function SearchTrack({ onProductTracked }) {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [trackingId, setTrackingId] = useState(null);
  const [actionMessage, setActionMessage] = useState(null);

  const search = async (searchTerm = '') => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.searchCatalog(searchTerm, 30, 0);
      setItems(data.items || []);
      setTotal(data.total || 0);
    } catch (err) {
      setError({
        code: err.code || 'SEARCH_FAILED',
        message: err.message
      });
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    search('');
  }, []);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    search(query);
  };

  const handleTrack = async (productId) => {
    setTrackingId(productId);
    setActionMessage(null);
    try {
      await api.trackProduct(productId);
      setActionMessage({ type: 'success', text: `Product #${productId} added to tracking. Initial scrape scheduled.` });
      // Update local state to mark as tracked
      setItems(prev => prev.map(item => item.id === productId ? { ...item, alreadyTracked: true } : item));
      if (onProductTracked) onProductTracked();
    } catch (err) {
      setActionMessage({
        type: 'error',
        text: `Failed to track #${productId}: [${err.code || 'ERROR'}] ${err.message}`
      });
    } finally {
      setTrackingId(null);
    }
  };

  return (
    <div className="card">
      <div className="card-title">
        <span>Search & Track Store Products</span>
        <span className="badge">{total} available in catalog</span>
      </div>

      <form onSubmit={handleSearchSubmit} className="search-bar">
        <input
          type="text"
          className="search-input"
          placeholder="Search by product name or keyword (e.g. Wireless, Pro, Smart)..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button type="submit" className="btn btn-primary" disabled={loading}>
          {loading ? 'Searching...' : 'Search'}
        </button>
        {query && (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => { setQuery(''); search(''); }}
            disabled={loading}
          >
            Clear
          </button>
        )}
      </form>

      {actionMessage && (
        <div className={`banner ${actionMessage.type === 'error' ? 'banner-error' : 'banner-stale'}`} style={actionMessage.type === 'success' ? { backgroundColor: 'var(--success-bg)', borderColor: '#86efac', color: '#166534' } : {}}>
          <span>{actionMessage.text}</span>
          <button className="btn btn-secondary btn-sm" onClick={() => setActionMessage(null)}>Dismiss</button>
        </div>
      )}

      {error && (
        <div className="banner banner-error">
          <span>⚠️ <strong>Error [{error.code}]:</strong> {error.message}</span>
        </div>
      )}

      {loading ? (
        <div className="state-empty">
          <div className="loading-spinner"></div>
          <p style={{ marginTop: '1rem' }}>Loading catalog products...</p>
        </div>
      ) : items.length === 0 ? (
        <div className="state-empty">
          <p>No products found {query ? `for "${query}"` : 'in catalog'}.</p>
          <small>No mock data is served. All items are synchronized from demo.inelabteamdev.com.</small>
        </div>
      ) : (
        <div className="table-responsive">
          <table>
            <thead>
              <tr>
                <th style={{ width: '80px' }}>Store ID</th>
                <th>Product Name</th>
                <th>Category</th>
                <th style={{ width: '140px', textAlign: 'right' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td className="cell-mono">#{item.id}</td>
                  <td style={{ fontWeight: 500 }}>{item.name}</td>
                  <td>{item.category || '—'}</td>
                  <td style={{ textAlign: 'right' }}>
                    {item.alreadyTracked ? (
                      <span className="badge-status success" style={{ fontSize: '0.75rem' }}>Tracked</span>
                    ) : (
                      <button
                        className="btn btn-primary btn-sm"
                        disabled={trackingId === item.id}
                        onClick={() => handleTrack(item.id)}
                      >
                        {trackingId === item.id ? 'Tracking...' : '+ Track'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
