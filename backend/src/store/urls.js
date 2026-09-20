/**
 * store/urls.js - Canonical URL builder and origin allow-list enforcement.
 * Enforces Rule R4: Only scrape demo.inelabteamdev.com.
 */

import { config } from '../config.js';

export const ALLOWED_ORIGIN = new URL(config.STORE_ORIGIN).origin;

/**
 * Asserts that a URL string belongs strictly to the allowed store origin.
 * Throws a SecurityError if validation fails.
 */
export function assertStoreOrigin(urlString) {
  if (!urlString || typeof urlString !== 'string') {
    throw new Error(`Invalid URL: must be a non-empty string`);
  }

  let parsed;
  try {
    parsed = new URL(urlString, ALLOWED_ORIGIN);
  } catch (err) {
    throw new Error(`Malformed URL "${urlString}": ${err.message}`);
  }

  if (parsed.origin !== ALLOWED_ORIGIN) {
    throw new Error(`Blocked SSRF / invalid origin: "${parsed.origin}" is not allowed. Expected "${ALLOWED_ORIGIN}".`);
  }

  return parsed.toString();
}

/**
 * Returns true if the URL belongs to the allowed store origin.
 */
export function isStoreOrigin(urlString) {
  try {
    assertStoreOrigin(urlString);
    return true;
  } catch {
    return false;
  }
}

/**
 * Builds the canonical product URL from a store product ID.
 * Clients only ever pass product IDs, never arbitrary URLs.
 */
export function buildProductUrl(productId) {
  if (productId === undefined || productId === null || productId === '') {
    throw new Error('Product ID is required');
  }

  const idStr = String(productId).trim();
  if (!/^\d+$/.test(idStr)) {
    throw new Error(`Invalid product ID format: "${productId}". Must be positive integer.`);
  }

  const url = `${ALLOWED_ORIGIN}/product/${idStr}`;
  return assertStoreOrigin(url);
}

/**
 * Builds an API URL for catalog or store data.
 */
export function buildApiUrl(apiPath) {
  const cleanPath = apiPath.startsWith('/') ? apiPath : `/${apiPath}`;
  const url = `${ALLOWED_ORIGIN}${cleanPath}`;
  return assertStoreOrigin(url);
}
