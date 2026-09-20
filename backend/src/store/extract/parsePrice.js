/**
 * extract/parsePrice.js - Pure price parsing with strict observed grammar.
 * Converts to integer minor units (paise) using string math (no floats).
 */

import { normalizeText } from './normalizeText.js';
import { ScrapeError, ERROR_CODES } from '../errors.js';

const MAX_PRICE_MINOR = 1_000_000_000n; // 10 million rupees ceiling

export function parsePrice(rawInput) {
  if (!rawInput) {
    throw new ScrapeError(ERROR_CODES.PRICE_UNPARSEABLE, 'Price input is empty');
  }

  const normalized = normalizeText(rawInput);

  // Detect currency
  let currency = 'INR';
  let withoutCurrency = normalized;

  if (normalized.startsWith('₹')) {
    currency = 'INR';
    withoutCurrency = normalized.slice(1).trim();
  } else if (/^Rs\.?\s*/i.test(normalized)) {
    currency = 'INR';
    withoutCurrency = normalized.replace(/^Rs\.?\s*/i, '').trim();
  } else if (/^INR\s*/i.test(normalized)) {
    currency = 'INR';
    withoutCurrency = normalized.replace(/^INR\s*/i, '').trim();
  } else if (normalized.startsWith('$')) {
    currency = 'USD';
    withoutCurrency = normalized.slice(1).trim();
  } else if (normalized.startsWith('€')) {
    currency = 'EUR';
    withoutCurrency = normalized.slice(1).trim();
  } else {
    // If no leading currency symbol, check if digits exist
    if (!/\d/.test(normalized)) {
      throw new ScrapeError(ERROR_CODES.PRICE_UNPARSEABLE, `No digits found in price: "${normalized}"`, { rawText: rawInput });
    }
  }

  // Strip trailing notes: e.g. "/- (incl. of all taxes)" or "/-"
  let cleanNumber = withoutCurrency
    .replace(/\/\s*-\s*(\(.*\))?/g, '')
    .trim();

  // Determine format pattern:
  // 1. Euro format: e.g. "12.723,00" or "12.723,50" -> dot is thousands separator, comma is decimal
  // 2. Standard format: e.g. "12,723.00" or "12 723.00" -> comma/space is thousands, dot is decimal
  // 3. Integer only: "12,723" or "12 723" or "12723"

  let majorStr = '';
  let minorStr = '00';

  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(cleanNumber)) {
    // Euro format: dots as thousand separators, comma as decimal
    const parts = cleanNumber.split(',');
    majorStr = parts[0].replace(/\./g, '');
    minorStr = (parts[1] || '00').padEnd(2, '0').slice(0, 2);
  } else if (/^\d{1,3}([,\s]\d{2,3})*(\.\d{1,2})?$/.test(cleanNumber) || /^\d+(\.\d{1,2})?$/.test(cleanNumber)) {
    // Standard / Indian grouping with optional decimals
    const parts = cleanNumber.split('.');
    majorStr = parts[0].replace(/[,\s]/g, '');
    minorStr = (parts[1] || '00').padEnd(2, '0').slice(0, 2);
  } else {
    // Fallback: test if removing commas/spaces leaves clean digits
    const digitsOnly = cleanNumber.replace(/[,\s]/g, '');
    if (/^\d+$/.test(digitsOnly)) {
      majorStr = digitsOnly;
      minorStr = '00';
    } else {
      throw new ScrapeError(ERROR_CODES.PRICE_UNPARSEABLE, `Unrecognized price format: "${cleanNumber}" (from "${rawInput}")`, {
        rawText: rawInput,
        cleanNumber
      });
    }
  }

  if (!majorStr || !/^\d+$/.test(majorStr) || !/^\d+$/.test(minorStr)) {
    throw new ScrapeError(ERROR_CODES.PRICE_UNPARSEABLE, `Failed to parse numeric value from "${rawInput}"`, { rawText: rawInput });
  }

  const priceMinor = BigInt(majorStr) * 100n + BigInt(minorStr);

  if (priceMinor <= 0n) {
    throw new ScrapeError(ERROR_CODES.PRICE_IMPLAUSIBLE, `Price must be positive, got ${priceMinor}`, { rawText: rawInput, priceMinor: String(priceMinor) });
  }

  if (priceMinor > MAX_PRICE_MINOR) {
    throw new ScrapeError(ERROR_CODES.PRICE_IMPLAUSIBLE, `Price exceeds ceiling, got ${priceMinor}`, { rawText: rawInput, priceMinor: String(priceMinor) });
  }

  return {
    priceMinor,
    currency,
    rawText: rawInput
  };
}
