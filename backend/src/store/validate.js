/**
 * store/validate.js - Pure validation gates V1–V9 per plan §8.4.
 * Every gate check is a pure function that either passes or throws a typed ScrapeError.
 */

import { z } from 'zod';
import { ScrapeError, ERROR_CODES } from './errors.js';

// Schema for raw product API response
export const ProductApiSchema = z.object({
  id: z.coerce.number().positive(),
  slug: z.string().min(1),
  name: z.string().min(1),
  brand: z.string().optional(),
  category: z.string().optional(),
  sku: z.string().optional()
});

// Schema for authoritative quote object
export const QuotePayloadSchema = z.object({
  p: z.number().positive(),
  s: z.number().int().min(0),
  c: z.string().length(3),
  t: z.number().positive(),
  m: z.number().positive().optional()
});

export const validationGates = {
  /**
   * V1: Response/page content check.
   */
  checkV1ExpectedContent({ httpStatus, body, isHtml = false, isSoftError = false }) {
    if (httpStatus && (httpStatus < 200 || httpStatus >= 300)) {
      if (httpStatus === 404) throw new ScrapeError(ERROR_CODES.NOT_FOUND, 'Product not found (404)', { httpStatus });
      if (httpStatus === 429) throw new ScrapeError(ERROR_CODES.HTTP_429, 'Rate limited (429)', { httpStatus });
      if (httpStatus >= 500) throw new ScrapeError(ERROR_CODES.HTTP_5XX, `Store server error (${httpStatus})`, { httpStatus });
      throw new ScrapeError(ERROR_CODES.HTTP_4XX_OTHER, `Store client error (${httpStatus})`, { httpStatus });
    }

    if (isSoftError) {
      throw new ScrapeError(ERROR_CODES.UNEXPECTED_CONTENT, 'Page returned 200 but displayed soft error state');
    }

    if (!body && !isHtml) {
      throw new ScrapeError(ERROR_CODES.UNEXPECTED_CONTENT, 'Empty response body received');
    }
  },

  /**
   * V2: Content readiness check. Rejects placeholder tokens.
   */
  checkV2ContentReady({ rawText, domText = '', isBusy = false }) {
    if (isBusy) {
      throw new ScrapeError(ERROR_CODES.CONTENT_NOT_READY, 'Element still has aria-busy="true" or active spinner');
    }

    const checkString = `${rawText || ''} ${domText || ''}`;
    const placeholders = [
      /loading/i,
      /checking availability/i,
      /price hidden/i,
      /hold on/i,
      /updating/i
    ];

    for (const ph of placeholders) {
      if (ph.test(checkString)) {
        throw new ScrapeError(ERROR_CODES.CONTENT_NOT_READY, `Placeholder token found: "${checkString.trim()}"`, {
          foundPlaceholder: ph.toString()
        });
      }
    }
  },

  /**
   * V3: Product identity check. Requested storeProductId must match payload.
   */
  checkV3ProductIdentity({ requestedId, receivedId, productName = '' }) {
    if (String(requestedId).trim() !== String(receivedId).trim()) {
      throw new ScrapeError(
        ERROR_CODES.PRODUCT_MISMATCH,
        `Requested product ID ${requestedId} does not match received ID ${receivedId}`,
        { requestedId, receivedId, productName }
      );
    }
  },

  /**
   * V4: Price sanity check.
   */
  checkV4PriceSane({ priceMinor, currency, ceilingMinor = 1_000_000_000n }) {
    if (typeof priceMinor !== 'bigint' && typeof priceMinor !== 'number') {
      throw new ScrapeError(ERROR_CODES.PRICE_UNPARSEABLE, 'priceMinor must be a BigInt or integer');
    }

    const val = BigInt(priceMinor);
    if (val <= 0n) {
      throw new ScrapeError(ERROR_CODES.PRICE_IMPLAUSIBLE, `Price must be greater than zero, got ${val}`);
    }

    if (val > ceilingMinor) {
      throw new ScrapeError(ERROR_CODES.PRICE_IMPLAUSIBLE, `Price exceeds ceiling (${ceilingMinor}), got ${val}`);
    }

    if (!currency || currency.length !== 3) {
      throw new ScrapeError(ERROR_CODES.PRICE_UNPARSEABLE, `Invalid 3-letter currency code: "${currency}"`);
    }
  },

  /**
   * V5: Price unambiguous check.
   */
  checkV5PriceUnambiguous({ candidates = [] }) {
    if (candidates.length === 0) {
      throw new ScrapeError(ERROR_CODES.CONTENT_NOT_READY, 'No price candidates available');
    }

    const uniqueMinor = new Set(candidates.map(c => String(c.priceMinor)));
    if (uniqueMinor.size > 1) {
      throw new ScrapeError(
        ERROR_CODES.PRICE_AMBIGUOUS,
        `Multiple conflicting price candidates: ${[...uniqueMinor].join(', ')}`,
        { candidates: [...uniqueMinor] }
      );
    }
  },

  /**
   * V6: Stability check. Two readings STABILITY_MS apart must agree.
   */
  checkV6Stability({ read1Minor, read2Minor, maxTolerancePct = 0 }) {
    if (read1Minor !== read2Minor) {
      throw new ScrapeError(
        ERROR_CODES.PRICE_UNSTABLE,
        `Price changed during stability check: read1=${read1Minor}, read2=${read2Minor}`,
        { read1: String(read1Minor), read2: String(read2Minor) }
      );
    }
  },

  /**
   * V7: Outlier confirmation check against last accepted price.
   */
  checkV7Outlier({ newPriceMinor, lastPriceMinor, isConfirmed = false, outlierPct = 35 }) {
    if (!lastPriceMinor || isConfirmed) return;

    const current = Number(newPriceMinor);
    const prev = Number(lastPriceMinor);
    const diffPct = Math.abs(current - prev) / prev * 100;

    if (diffPct > outlierPct) {
      throw new ScrapeError(
        ERROR_CODES.PRICE_IMPLAUSIBLE,
        `Price deviation (${diffPct.toFixed(1)}%) exceeds outlier threshold (${outlierPct}%); unconfirmed second read`,
        { newPriceMinor: String(newPriceMinor), lastPriceMinor: String(lastPriceMinor), diffPct }
      );
    }
  },

  /**
   * V8: Stock recognized check.
   */
  checkV8StockRecognized({ stockState, quantity }) {
    const validStates = ['in_stock', 'low_stock', 'out_of_stock'];
    if (!stockState || !validStates.includes(stockState)) {
      throw new ScrapeError(ERROR_CODES.STOCK_UNRECOGNIZED, `Stock state "${stockState}" is not recognized`);
    }

    if (quantity !== null && quantity !== undefined && quantity < 0) {
      throw new ScrapeError(ERROR_CODES.STOCK_CONFLICT, `Negative stock quantity: ${quantity}`);
    }

    if (stockState === 'out_of_stock' && quantity !== null && quantity > 0) {
      throw new ScrapeError(ERROR_CODES.STOCK_CONFLICT, `State is out_of_stock but quantity is ${quantity}`);
    }
  },

  /**
   * V9: Freshness / token expiry check.
   */
  checkV9Freshness({ quoteTimestamp, maxAgeMs = 120000 }) {
    if (!quoteTimestamp) return;

    const age = Date.now() - Number(quoteTimestamp);
    if (age > maxAgeMs) {
      throw new ScrapeError(ERROR_CODES.TOKEN_EXPIRED, `Quote timestamp is stale (${(age / 1000).toFixed(1)}s old)`, {
        ageMs: age
      });
    }
  }
};
