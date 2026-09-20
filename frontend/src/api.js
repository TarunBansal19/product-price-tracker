/**
 * api.js - Frontend HTTP client per plan §11
 * Handles cold-start wakeup retries for GET requests, consistent error unpacking.
 */

const rawBase = import.meta.env.VITE_API_BASE_URL || (
  typeof window !== 'undefined' && window.location.hostname === 'localhost'
    ? 'http://localhost:3001/api'
    : '/api'
);

const normalizedBase = rawBase.replace(/\/+$/, '');
const API_BASE = normalizedBase.endsWith('/api')
  ? normalizedBase
  : `${normalizedBase}/api`;

let wakeupListeners = new Set();

export function subscribeWakeup(listener) {
  wakeupListeners.add(listener);
  return () => wakeupListeners.delete(listener);
}

function notifyWakeup(isWakingUp, message = '') {
  for (const listener of wakeupListeners) {
    listener(isWakingUp, message);
  }
}

/**
 * Fetch wrapper with cold-start retry for GET requests
 */
async function request(path, options = {}) {
  const url = `${API_BASE}${path}`;
  const isGet = !options.method || options.method === 'GET';
  const maxRetries = isGet ? 3 : 0;
  const timeoutMs = options.timeout || (isGet ? 15000 : 30000);

  let attempt = 0;
  while (attempt <= maxRetries) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      if (attempt > 0) {
        notifyWakeup(true, `Waking up the backend (free tier, up to ~1 min)... attempt ${attempt + 1}/${maxRetries + 1}`);
      }

      const res = await fetch(url, {
        ...options,
        signal: options.signal || controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(options.headers || {})
        }
      });

      clearTimeout(timeoutId);

      if (attempt > 0) {
        notifyWakeup(false);
      }

      const contentType = res.headers.get('content-type') || '';
      const isJson = contentType.includes('application/json');
      const data = isJson ? await res.json() : await res.text();

      if (!res.ok) {
        const err = new Error(
          (data && data.error && data.error.message) ||
          (data && data.message) ||
          `HTTP ${res.status} ${res.statusText}`
        );
        err.status = res.status;
        err.code = (data && data.error && data.error.code) || 'HTTP_ERROR';
        err.data = data;
        throw err;
      }

      return data;
    } catch (err) {
      clearTimeout(timeoutId);

      // Check if network error or cold-start timeout on GET
      const isAbortOrNetwork = err.name === 'AbortError' || err.message.includes('Failed to fetch') || err.status === 502 || err.status === 503 || err.status === 504;

      if (isGet && isAbortOrNetwork && attempt < maxRetries) {
        attempt++;
        notifyWakeup(true, `Waking up the backend (free tier, up to ~1 min)... waiting for instance`);
        await new Promise(r => setTimeout(r, 2000 * attempt));
        continue;
      }

      notifyWakeup(false);
      throw err;
    }
  }
}

export const api = {
  getHealth: () => request('/health', { timeout: 4000 }),

  searchCatalog: (q = '', limit = 20, offset = 0) => {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (q) params.set('q', q);
    return request(`/catalog/search?${params.toString()}`);
  },

  getTrackedProducts: () => request('/tracked'),

  trackProduct: (storeProductId) =>
    request('/tracked', {
      method: 'POST',
      body: JSON.stringify({ storeProductId })
    }),

  untrackProduct: (id) =>
    request(`/tracked/${id}`, {
      method: 'DELETE'
    }),

  getObservationHistory: (id, { from, to, limit = 500 } = {}) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    return request(`/tracked/${id}/history?${params.toString()}`);
  },

  getAttemptLog: (id, { limit = 50, before, outcome } = {}) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (before) params.set('before', before);
    if (outcome) params.set('outcome', outcome);
    return request(`/tracked/${id}/log?${params.toString()}`);
  },

  triggerManualScrape: (id) =>
    request(`/tracked/${id}/scrape`, {
      method: 'POST'
    })
};
