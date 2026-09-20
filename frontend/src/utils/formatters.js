/**
 * formatters.js - Formatting utilities per plan §11
 * - Timestamps rendered in IST with UTC on hover
 * - Prices formatted from price_minor + currency
 */

/**
 * Format timestamp in IST (Asia/Kolkata) with UTC tooltip value
 * @param {string|Date} ts
 * @returns {{ text: string, utc: string }}
 */
export function formatTimestamp(ts) {
  if (!ts) return { text: '—', utc: '' };
  try {
    const date = new Date(ts);
    if (isNaN(date.getTime())) return { text: 'Invalid date', utc: '' };

    const istString = date.toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    }) + ' IST';

    const utcString = date.toISOString().replace('T', ' ').replace('Z', ' UTC');

    return { text: istString, utc: utcString };
  } catch {
    return { text: String(ts), utc: '' };
  }
}

/**
 * Format price from integer minor units (paise/cents)
 * @param {number|bigint} priceMinor
 * @param {string} currency
 * @returns {string}
 */
export function formatPrice(priceMinor, currency = 'INR') {
  if (priceMinor === null || priceMinor === undefined || isNaN(Number(priceMinor))) {
    return '—';
  }

  const major = Number(priceMinor) / 100;
  if (currency === 'INR') {
    return `₹${major.toLocaleString('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })}`;
  }

  return `${currency} ${major.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

/**
 * Format stock state to readable label
 * @param {string} state
 * @param {number|null} quantity
 * @returns {string}
 */
export function formatStock(state, quantity = null) {
  if (!state) return '—';
  const labels = {
    in_stock: 'In Stock',
    low_stock: quantity !== null ? `Low Stock (${quantity} left)` : 'Low Stock',
    out_of_stock: 'Out of Stock'
  };
  return labels[state] || state.replace(/_/g, ' ');
}
