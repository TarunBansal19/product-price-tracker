/**
 * formatters.js - Formatting utilities per plan §11
 * - Timestamps rendered in IST with UTC on hover
 * - Prices formatted from price_minor + currency
 */

/**
 * Format timestamp in IST (Asia/Kolkata) with UTC tooltip value
 * e.g. "Sep 20, 12:30:07 PM"
 * @param {string|Date} ts
 * @returns {{ text: string, utc: string }}
 */
export function formatTimestamp(ts) {
  if (!ts) return { text: '—', utc: '' };
  try {
    const date = new Date(ts);
    if (isNaN(date.getTime())) return { text: '—', utc: '' };

    const istString = date.toLocaleString('en-US', {
      timeZone: 'Asia/Kolkata',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    });

    const utcString = date.toISOString().replace('T', ' ').replace('Z', ' UTC');

    return { text: istString, utc: utcString };
  } catch {
    return { text: String(ts), utc: '' };
  }
}

/**
 * Format duration in ms into readable seconds or minutes
 * e.g. "6.2 s", "2 min 4 s"
 * @param {number|null} durationMs
 * @returns {string}
 */
export function formatDuration(durationMs) {
  if (durationMs === null || durationMs === undefined) return '—';
  const sec = durationMs / 1000;
  if (sec < 60) {
    return `${sec.toFixed(1)} s`;
  }
  const min = Math.floor(sec / 60);
  const remSec = Math.round(sec % 60);
  return `${min} min ${remSec} s`;
}

/**
 * Format price from integer minor units (paise/cents)
 * @param {number|bigint|string} priceMinor
 * @param {string} currency
 * @param {boolean} includeDecimals
 * @returns {string}
 */
export function formatPrice(priceMinor, currency = 'INR', includeDecimals = true) {
  if (priceMinor === null || priceMinor === undefined || priceMinor === '') return '—';
  const num = Number(priceMinor);
  if (isNaN(num)) return '—';

  const major = num / 100;
  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: currency || 'INR',
      minimumFractionDigits: includeDecimals ? 2 : 0,
      maximumFractionDigits: includeDecimals ? 2 : 0
    }).format(major);
  } catch {
    return `₹${major.toFixed(includeDecimals ? 2 : 0)}`;
  }
}

/**
 * Format stock state to readable label per spec (Sentence case)
 * @param {string} state
 * @param {number|null} quantity
 * @returns {string}
 */
export function formatStock(state, quantity = null) {
  if (!state) return 'No stock data';
  if (state === 'in_stock') {
    return quantity !== null && quantity !== undefined ? `In stock, ${quantity} left` : 'In stock';
  }
  if (state === 'low_stock') {
    return quantity !== null && quantity !== undefined ? `Low stock, ${quantity} left` : 'Low stock';
  }
  if (state === 'out_of_stock') {
    return 'Out of stock';
  }
  return state.replace(/_/g, ' ');
}

/**
 * Format relative time distance to now
 * @param {string|Date} ts
 * @returns {string}
 */
export function formatDistanceToNow(ts) {
  if (!ts) return 'never';
  const time = new Date(ts).getTime();
  if (isNaN(time)) return 'never';

  const diffSec = Math.max(0, Math.floor((Date.now() - time) / 1000));
  if (diffSec < 45) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} ${diffMin === 1 ? 'minute' : 'minutes'} ago`;
  const diffHours = Math.floor(diffMin / 60);
  const remMin = diffMin % 60;
  if (diffHours < 24) {
    if (remMin === 0) return `${diffHours} ${diffHours === 1 ? 'hour' : 'hours'} ago`;
    return `${diffHours} h ${remMin} min ago`;
  }
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays} ${diffDays === 1 ? 'day' : 'days'} ago`;
}

/**
 * Calculate text for next run based on last run time + 2-hour interval.
 * Derives the schedule from the actual last run rather than assuming
 * a fixed UTC-hour grid, so it works regardless of cron timezone.
 * @param {string|null} lastRunStartedAt - ISO timestamp of the last run
 * @returns {string}
 */
export function getNextRunText(lastRunStartedAt) {
  const INTERVAL_MS = 2 * 60 * 60 * 1000; // 2 hours
  const now = Date.now();

  if (!lastRunStartedAt) {
    return 'Next run: waiting for first cron';
  }

  let nextRun = new Date(lastRunStartedAt).getTime() + INTERVAL_MS;

  // If that's already in the past, advance by intervals until it's in the future
  while (nextRun <= now) {
    nextRun += INTERVAL_MS;
  }

  const diffMs = nextRun - now;
  const diffMinutes = Math.max(1, Math.ceil(diffMs / (60 * 1000)));
  const h = Math.floor(diffMinutes / 60);
  const m = diffMinutes % 60;

  if (h > 0 && m > 0) {
    return `Next run in ${h} h ${m} min`;
  } else if (h > 0) {
    return `Next run in ${h} h`;
  } else {
    return `Next run in ${m} min`;
  }
}
