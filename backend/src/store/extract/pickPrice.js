/**
 * extract/pickPrice.js - Pure price selection and cross-checking per plan §8.2.
 */

import { parsePrice } from './parsePrice.js';
import { parseStock } from './parseStock.js';
import { ScrapeError, ERROR_CODES } from '../errors.js';

export function pickPrice({ authoritativeQuote = null, domCandidates = [], blockText = '' }) {
  // 1. Filter DOM candidates for viable price candidates
  const viableDomPrices = [];
  const viableDomStocks = [];

  for (const c of domCandidates) {
    // Ignore invisible, struck-through, discount badges, or non-price cues
    if (!c.visible) continue;
    if (c.struckThrough) continue;

    const text = (c.text || '').trim();
    if (!text) continue;

    // Reject discount percentage badges (e.g. "19% off")
    if (/\d+%\s*off/i.test(text) || /discount/i.test(text)) continue;

    // Check if it looks like a price (has currency or digits with currency-like context)
    if (/^(₹|Rs\.?|\$|€)/i.test(text) || (/\d/.test(text) && !/left|stock|rating|reviews|warranty/i.test(text))) {
      try {
        const parsed = parsePrice(text);
        viableDomPrices.push({
          rawText: text,
          parsed,
          className: c.className || ''
        });
      } catch {
        // Not a parseable price
      }
    }

    // Check if it looks like stock
    if (/stock|left|unavailable/i.test(text) && !/warranty/i.test(text)) {
      try {
        const parsed = parseStock(text);
        viableDomStocks.push({
          rawText: text,
          parsed
        });
      } catch {
        // Not a parseable stock
      }
    }
  }

  // 2. Process Authoritative Quote if present
  let selectedPriceMinor = null;
  let selectedCurrency = 'INR';
  let selectedStockState = 'in_stock';
  let selectedStockQuantity = null;
  let rawPriceText = '';
  let rawStockText = '';
  let priceSource = 'dom_visible';
  let crossChecked = false;
  let listPriceMinor = null;

  if (authoritativeQuote && typeof authoritativeQuote.p === 'number') {
    selectedPriceMinor = BigInt(Math.round(authoritativeQuote.p)) * 100n;
    selectedCurrency = authoritativeQuote.c || 'INR';
    selectedStockQuantity = typeof authoritativeQuote.s === 'number' ? authoritativeQuote.s : null;
    priceSource = 'authoritative_quote';
    rawPriceText = `quote:p=${authoritativeQuote.p}`;

    if (authoritativeQuote.m && typeof authoritativeQuote.m === 'number') {
      listPriceMinor = BigInt(Math.round(authoritativeQuote.m)) * 100n;
    }

    if (selectedStockQuantity === 0) {
      selectedStockState = 'out_of_stock';
    } else if (selectedStockQuantity !== null && selectedStockQuantity <= 10) {
      selectedStockState = 'low_stock';
    } else {
      selectedStockState = 'in_stock';
    }

    // Cross-check with DOM price candidates
    const matchingDom = viableDomPrices.find(vp => vp.parsed.priceMinor === selectedPriceMinor);
    if (matchingDom) {
      crossChecked = true;
      rawPriceText = matchingDom.rawText;
    } else if (viableDomPrices.length > 0) {
      // DOM price is present but does not match authoritative quote
      // Log for review; if DOM candidates disagree among themselves, flag ambiguity
      const distinctDomValues = new Set(viableDomPrices.map(vp => String(vp.parsed.priceMinor)));
      if (distinctDomValues.size > 1) {
        throw new ScrapeError(ERROR_CODES.PRICE_AMBIGUOUS, `Authoritative quote (${selectedPriceMinor}) and divergent DOM prices (${[...distinctDomValues].join(', ')})`, {
          quotePrice: String(selectedPriceMinor),
          domPrices: [...distinctDomValues]
        });
      }
    }

    // Stock phrasing cross-check
    if (viableDomStocks.length > 0) {
      rawStockText = viableDomStocks[0].rawText;
      if (viableDomStocks[0].parsed.quantity !== null && selectedStockQuantity !== null) {
        if (viableDomStocks[0].parsed.quantity === selectedStockQuantity) {
          // Both stock signals agree
          selectedStockState = viableDomStocks[0].parsed.stockState;
        }
      }
    } else {
      rawStockText = `quote:s=${selectedStockQuantity}`;
    }
  } else {
    // No authoritative quote: rely on DOM candidates only
    if (viableDomPrices.length === 0) {
      throw new ScrapeError(ERROR_CODES.CONTENT_NOT_READY, 'No visible price candidates found in DOM', {
        domCandidateCount: domCandidates.length
      });
    }

    const distinctPrices = new Set(viableDomPrices.map(vp => String(vp.parsed.priceMinor)));
    if (distinctPrices.size > 1) {
      throw new ScrapeError(ERROR_CODES.PRICE_AMBIGUOUS, `Multiple conflicting visible prices: ${[...distinctPrices].join(', ')}`, {
        candidates: viableDomPrices.map(p => ({ text: p.rawText, minor: String(p.parsed.priceMinor) }))
      });
    }

    const first = viableDomPrices[0];
    selectedPriceMinor = first.parsed.priceMinor;
    selectedCurrency = first.parsed.currency;
    rawPriceText = first.rawText;
    priceSource = 'dom_visible';
    crossChecked = viableDomPrices.length >= 2;

    if (viableDomStocks.length === 0) {
      throw new ScrapeError(ERROR_CODES.STOCK_MISSING, 'No stock indicator found in DOM');
    }

    selectedStockState = viableDomStocks[0].parsed.stockState;
    selectedStockQuantity = viableDomStocks[0].parsed.quantity;
    rawStockText = viableDomStocks[0].rawText;
  }

  if (selectedPriceMinor === null || selectedPriceMinor <= 0n) {
    throw new ScrapeError(ERROR_CODES.PRICE_UNPARSEABLE, 'Failed to extract a positive price');
  }

  return {
    priceMinor: selectedPriceMinor,
    currency: selectedCurrency,
    stockState: selectedStockState,
    stockQuantity: selectedStockQuantity,
    listPriceMinor,
    rawPriceText,
    rawStockText,
    priceSource,
    crossChecked
  };
}
