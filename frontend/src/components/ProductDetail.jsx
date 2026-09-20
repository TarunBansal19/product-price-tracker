import React, { useState, useEffect } from 'react';
import { api } from '../api.js';
import { formatPrice, formatStock, formatTimestamp } from '../utils/formatters.js';

export function ProductDetail({ product, onBack }) {
  const [activeTab, setActiveTab] = useState('history'); // 'history' | 'log'
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState(null);

  const [attempts, setAttempts] = useState([]);
  const [logLoading, setLogLoading] = useState(false);
  const [logError, setLogError] = useState(null);
  const [outcomeFilter, setOutcomeFilter] = useState('');
  const [scraping, setScraping] = useState(false);
  const [actionMessage, setActionMessage] = useState(null);

  const fetchHistory = async () => {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const data = await api.getObservationHistory(product.id);
      setHistory(data.observations || []);
    } catch (err) {
      setHistoryError(err.message);
    } finally {
      setHistoryLoading(false);
    }
  };

  const fetchLog = async (filter = outcomeFilter) => {
    setLogLoading(true);
    setLogError(null);
    try {
      const data = await api.getAttemptLog(product.id, {
        limit: 50,
        outcome: filter || undefined
      });
      setAttempts(data.attempts || []);
    } catch (err) {
      setLogError(err.message);
    } finally {
      setLogLoading(false);
    }
  };

  useEffect(() => {
    fetchHistory();
    fetchLog();
  }, [product.id]);

  const handleManualScrape = async () => {
    setScraping(true);
    setActionMessage(null);
    try {
      await api.triggerManualScrape(product.id);
      setActionMessage({
        type: 'success',
        text: 'Manual scrape started in background. Refreshing history in 5 seconds...'
      });
      setTimeout(() => {
        fetchHistory();
        fetchLog();
      }, 5000);
    } catch (err) {
      setActionMessage({
        type: 'error',
        text: `Manual scrape failed: [${err.code || 'ERROR'}] ${err.message}`
      });
    } finally {
      setScraping(false);
    }
  };

  return (
    <div>
      <div style={{ marginBottom: '1rem' }}>
        <button className="btn btn-secondary btn-sm" onClick={onBack}>
          ← Back to Tracked Products
        </button>
      </div>

      <div className="card">
        <div className="detail-header">
          <div>
            <h2>{product.name}</h2>
            <div className="detail-product-id">
              Store ID: #{product.store_product_id} • Category: {product.category || 'General'}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <button
              className="btn btn-primary"
              disabled={scraping}
              onClick={handleManualScrape}
            >
              {scraping ? 'Triggering...' : '⚡ Trigger Scrape Now'}
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

        <div className="detail-meta-grid">
          <div className="meta-box">
            <div className="meta-box-label">Status</div>
            <div className="meta-box-value" style={{ fontSize: '1rem', color: product.is_active ? 'var(--success)' : 'var(--text-muted)' }}>
              {product.is_active ? '● Active Tracking' : '○ Deactivated'}
            </div>
          </div>
          <div className="meta-box">
            <div className="meta-box-label">Recorded Observations</div>
            <div className="meta-box-value">{history.length}</div>
          </div>
          <div className="meta-box">
            <div className="meta-box-label">Consecutive Failures</div>
            <div className="meta-box-value" style={{ color: product.consecutive_failed_jobs > 0 ? 'var(--danger)' : 'var(--text-main)' }}>
              {product.consecutive_failed_jobs}
            </div>
          </div>
          <div className="meta-box">
            <div className="meta-box-label">Last Success</div>
            <div className="meta-box-value" style={{ fontSize: '0.9rem', fontWeight: 500 }}>
              {product.last_success_at ? formatTimestamp(product.last_success_at).text : 'Never'}
            </div>
          </div>
        </div>

        <div className="tabs">
          <button
            className={`tab-btn ${activeTab === 'history' ? 'active' : ''}`}
            onClick={() => setActiveTab('history')}
          >
            Price & Stock History ({history.length})
          </button>
          <button
            className={`tab-btn ${activeTab === 'log' ? 'active' : ''}`}
            onClick={() => setActiveTab('log')}
          >
            Scrape Attempt Log ({attempts.length})
          </button>
        </div>

        {activeTab === 'history' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <span style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>
                Append-only observations from validated scrape attempts. No fabricated or back-filled data.
              </span>
              <button className="btn btn-secondary btn-sm" onClick={fetchHistory} disabled={historyLoading}>
                {historyLoading ? 'Refreshing...' : '↻ Refresh History'}
              </button>
            </div>

            {historyError && (
              <div className="banner banner-error">
                <span>Failed to load history: {historyError}</span>
              </div>
            )}

            {historyLoading && history.length === 0 ? (
              <div className="state-empty">
                <div className="loading-spinner"></div>
                <p style={{ marginTop: '1rem' }}>Loading price & stock history...</p>
              </div>
            ) : history.length === 0 ? (
              <div className="state-empty">
                <p>No observations yet — first scrape pending.</p>
                <small>Observations are only written when a scrape attempt passes all 9 validation gates.</small>
              </div>
            ) : (
              <div className="table-responsive">
                <table>
                  <thead>
                    <tr>
                      <th>Observed At (IST / UTC)</th>
                      <th>Current Price</th>
                      <th>Stock State</th>
                      <th>Raw Price Extracted</th>
                      <th>Raw Stock Extracted</th>
                      <th>Signal Source</th>
                      <th style={{ textAlign: 'center' }}>Cross Checked</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((obs) => {
                      const ts = formatTimestamp(obs.observed_at);
                      return (
                        <tr key={obs.id}>
                          <td>
                            <span className="timestamp" title={ts.utc}>
                              {ts.text}
                            </span>
                          </td>
                          <td style={{ fontWeight: 700, fontSize: '0.95rem' }}>
                            {formatPrice(obs.price_minor, obs.currency)}
                          </td>
                          <td>
                            <span className={`badge-status ${obs.stock_state}`}>
                              {formatStock(obs.stock_state, obs.stock_quantity)}
                            </span>
                          </td>
                          <td className="cell-mono" style={{ color: 'var(--text-muted)' }}>
                            {obs.raw_price_text || '—'}
                          </td>
                          <td className="cell-mono" style={{ color: 'var(--text-muted)' }}>
                            {obs.raw_stock_text || '—'}
                          </td>
                          <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                            {obs.price_source}
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            {obs.cross_checked ? (
                              <span style={{ color: 'var(--success)', fontWeight: 'bold' }}>✓ Agreed</span>
                            ) : (
                              <span style={{ color: 'var(--text-muted)' }}>—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {activeTab === 'log' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <span style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>Filter outcome:</span>
                <select
                  className="search-input"
                  style={{ padding: '0.3rem 0.6rem', fontSize: '0.85rem' }}
                  value={outcomeFilter}
                  onChange={(e) => {
                    setOutcomeFilter(e.target.value);
                    fetchLog(e.target.value);
                  }}
                >
                  <option value="">All Outcomes</option>
                  <option value="success">Success only</option>
                  <option value="retried">Retried attempts</option>
                  <option value="failed">Failed attempts</option>
                </select>
              </div>
              <button className="btn btn-secondary btn-sm" onClick={() => fetchLog(outcomeFilter)} disabled={logLoading}>
                {logLoading ? 'Refreshing...' : '↻ Refresh Log'}
              </button>
            </div>

            {logError && (
              <div className="banner banner-error">
                <span>Failed to load scrape logs: {logError}</span>
              </div>
            )}

            {logLoading && attempts.length === 0 ? (
              <div className="state-empty">
                <div className="loading-spinner"></div>
                <p style={{ marginTop: '1rem' }}>Loading scrape attempt log...</p>
              </div>
            ) : attempts.length === 0 ? (
              <div className="state-empty">
                <p>No scrape attempts recorded yet.</p>
                <small>Every retry, failure, and success will be truthfully logged here.</small>
              </div>
            ) : (
              <div className="table-responsive">
                <table>
                  <thead>
                    <tr>
                      <th>Timestamp (IST / UTC)</th>
                      <th style={{ textAlign: 'center' }}>Attempt #</th>
                      <th>Outcome</th>
                      <th>Duration</th>
                      <th>Strategy</th>
                      <th>Error Code</th>
                      <th>Message / Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {attempts.map((att) => {
                      const ts = formatTimestamp(att.started_at);
                      return (
                        <tr key={att.id}>
                          <td>
                            <span className="timestamp" title={ts.utc}>
                              {ts.text}
                            </span>
                          </td>
                          <td style={{ textAlign: 'center', fontWeight: 600 }}>
                            {att.attempt_number}
                          </td>
                          <td>
                            <span className={`badge-status ${att.outcome || 'retried'}`}>
                              {att.outcome || 'in_flight'}
                            </span>
                          </td>
                          <td className="cell-mono">
                            {att.duration_ms ? `${att.duration_ms} ms` : '—'}
                          </td>
                          <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                            {att.strategy}
                          </td>
                          <td>
                            {att.error_code ? (
                              <span className="badge-status failed" style={{ fontSize: '0.75rem' }}>
                                {att.error_code}
                              </span>
                            ) : (
                              <span style={{ color: 'var(--text-muted)' }}>—</span>
                            )}
                          </td>
                          <td style={{ maxWidth: '300px', fontSize: '0.8rem', color: att.error_message ? 'var(--danger)' : 'var(--text-muted)' }}>
                            {att.error_message || (att.outcome === 'success' ? 'Validated & recorded' : '—')}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
