/**
 * extract/parseStock.js - Pure stock parsing for observed store vocabulary.
 */

import { normalizeText } from './normalizeText.js';
import { ScrapeError, ERROR_CODES } from '../errors.js';

export function parseStock(rawInput) {
  if (!rawInput || typeof rawInput !== 'string' || !rawInput.trim()) {
    throw new ScrapeError(ERROR_CODES.STOCK_MISSING, 'Stock information is missing or empty');
  }

  const text = normalizeText(rawInput);

  // Check out of stock
  if (/^out of stock$/i.test(text) || /temporarily unavailable/i.test(text)) {
    return {
      stockState: 'out_of_stock',
      quantity: 0,
      rawText: rawInput
    };
  }

  // Check phrasing with digits:
  // "In stock · 96 left"
  // "Only 5 left"
  // "96 in stock"
  // "Selling fast — 8 left"
  // "Hurry, just 3 left"
  const inStockDotMatch = text.match(/in stock\s*[·•-]\s*(\d+)\s*left/i);
  const onlyLeftMatch = text.match(/only\s*(\d+)\s*left/i);
  const nInStockMatch = text.match(/(\d+)\s*in stock/i);
  const sellingFastMatch = text.match(/selling fast\s*[—–-]\s*(\d+)\s*left/i);
  const hurryJustMatch = text.match(/hurry,?\s*just\s*(\d+)\s*left/i);

  const matched = inStockDotMatch || onlyLeftMatch || nInStockMatch || sellingFastMatch || hurryJustMatch;

  if (matched) {
    const qty = parseInt(matched[1], 10);
    const isUrgentPhrase = Boolean(onlyLeftMatch || sellingFastMatch || hurryJustMatch);

    let stockState = 'in_stock';
    if (qty === 0) {
      stockState = 'out_of_stock';
    } else if (qty <= 10 || isUrgentPhrase) {
      stockState = 'low_stock';
    }

    return {
      stockState,
      quantity: qty,
      rawText: rawInput
    };
  }

  // Plain "In stock" without number
  if (/^in stock$/i.test(text)) {
    return {
      stockState: 'in_stock',
      quantity: null,
      rawText: rawInput
    };
  }

  // Unrecognized phrasing
  throw new ScrapeError(ERROR_CODES.STOCK_UNRECOGNIZED, `Unrecognized stock phrasing: "${text}"`, {
    rawText: rawInput,
    normalizedText: text
  });
}
