import React, { useState, useEffect, useRef } from 'react';
import { api } from '../api.js';

/**
 * Highlights the matched query text inside product name with weight 600
 */
function highlightMatch(text, query) {
  if (!query || !text) return text;
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase().trim();
  const idx = lowerText.indexOf(lowerQuery);
  if (idx === -1) return text;

  const before = text.slice(0, idx);
  const match = text.slice(idx, idx + lowerQuery.length);
  const after = text.slice(idx + lowerQuery.length);

  return (
    <>
      {before}
      <strong style={{ fontWeight: 600 }}>{match}</strong>
      {after}
    </>
  );
}

export function SearchAutocomplete({ trackedProductIds = new Set(), onProductTracked }) {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [isWakingUp, setIsWakingUp] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [trackingId, setTrackingId] = useState(null);

  const containerRef = useRef(null);
  const abortControllerRef = useRef(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Debounced search
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setLoading(false);
      setError(null);
      setIsOpen(false);
      setSelectedIndex(-1);
      return;
    }

    setIsOpen(true);
    setLoading(true);
    setError(null);
    setSelectedIndex(-1);

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    const timer = setTimeout(async () => {
      try {
        const data = await api.searchCatalog(trimmed, 8, 0);
        if (!controller.signal.aborted) {
          setResults(data.items || []);
          setIsWakingUp(false);
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          if (err.message && err.message.includes('Waking up')) {
            setIsWakingUp(true);
          } else {
            setError(err);
          }
          setResults([]);
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }, 250);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const handleTrack = async (item) => {
    setTrackingId(item.id);
    try {
      const res = await api.trackProduct(item.id);
      // Close dropdown and clear query
      setIsOpen(false);
      setQuery('');
      setResults([]);
      if (onProductTracked) {
        // Pass newly tracked product info so it can be selected immediately
        onProductTracked(res.product || { store_product_id: String(item.id), name: item.name });
      }
    } catch (err) {
      alert(`Failed to track product: [${err.code || 'ERROR'}] ${err.message}`);
    } finally {
      setTrackingId(null);
    }
  };

  const handleKeyDown = (e) => {
    if (!isOpen || results.length === 0) {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev < results.length - 1 ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : results.length - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (selectedIndex >= 0 && selectedIndex < results.length) {
        const item = results[selectedIndex];
        const isTracked = item.alreadyTracked || trackedProductIds.has(String(item.id));
        if (!isTracked) {
          handleTrack(item);
        }
      }
    } else if (e.key === 'Escape') {
      setIsOpen(false);
    }
  };

  return (
    <div className="rail-search-container" ref={containerRef}>
      <div className={`rail-search-box ${isOpen ? 'focused' : ''}`}>
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
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => {
            if (query.trim()) setIsOpen(true);
          }}
          onKeyDown={handleKeyDown}
        />
      </div>

      {isOpen && (
        <div className="search-dropdown" role="listbox">
          {loading ? (
            <div className="search-dropdown-state">
              {isWakingUp
                ? 'Waking up the backend. This can take up to a minute on the free tier.'
                : 'Searching...'}
            </div>
          ) : error ? (
            <div className="search-dropdown-state error">
              <span>Error [{error.code || 'CATALOG_ERROR'}]: {error.message}</span>
              <button
                className="btn-track"
                onClick={() => {
                  setError(null);
                  setQuery(q => q + ' ');
                }}
              >
                Retry
              </button>
            </div>
          ) : results.length === 0 ? (
            <div className="search-dropdown-state">
              No products match '{query.trim()}'
            </div>
          ) : (
            <div className="search-dropdown-list">
              {results.map((item, index) => {
                const isTracked = item.alreadyTracked || trackedProductIds.has(String(item.id));
                const isSelected = index === selectedIndex;
                const isTracking = trackingId === item.id;

                return (
                  <div
                    key={item.id}
                    className={`search-dropdown-item ${isSelected ? 'highlighted' : ''}`}
                    onMouseEnter={() => setSelectedIndex(index)}
                    onClick={() => {
                      if (!isTracked && !isTracking) {
                        handleTrack(item);
                      }
                    }}
                    role="option"
                    aria-selected={isSelected}
                  >
                    <div className="search-item-info">
                      <span className="search-item-name">
                        {highlightMatch(item.name, query)}
                      </span>
                      <span className="search-item-category">
                        {item.category || 'General'}
                      </span>
                    </div>

                    {isTracked ? (
                      <div className="search-item-tracking-badge">
                        <span className="search-item-tracking-check">✓</span>
                        <span>Tracking</span>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="btn-track"
                        disabled={isTracking}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleTrack(item);
                        }}
                      >
                        {isTracking ? 'Tracking...' : 'Track'}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div className="search-dropdown-footer">
            Product list refreshed daily
          </div>
        </div>
      )}
    </div>
  );
}
