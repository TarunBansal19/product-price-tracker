/**
 * routes/tracked.js - Manage tracked products, history, attempt logs, and manual scrapes.
 */

import express from 'express';
import { z } from 'zod';
import { repo } from '../db/repo.js';
import { validateBody, validateQuery } from '../middleware/validate.js';
import { mutationRateLimiter, manualScrapeLimiter } from '../middleware/rateLimit.js';
import { getBrowser } from '../store/browserPool.js';
import { executeProductJob } from '../runner/jobRunner.js';
import { config } from '../config.js';
import { buildProductUrl } from '../store/urls.js';

export const trackedRouter = express.Router();

const trackProductSchema = z.object({
  storeProductId: z.union([z.string(), z.number()]).transform(v => String(v).trim())
});

const historyQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().min(1).max(1000).default(500)
});

const logQuerySchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(50),
  before: z.string().datetime().optional(),
  outcome: z.enum(['success', 'retried', 'failed']).optional()
});

// GET /api/tracked - List all tracked products
trackedRouter.get('/', async (req, res, next) => {
  try {
    const products = await repo.getTrackedProducts();
    res.json({ products });
  } catch (err) {
    next(err);
  }
});

// POST /api/tracked - Track a new product
trackedRouter.post('/', mutationRateLimiter, validateBody(trackProductSchema), async (req, res, next) => {
  try {
    const { storeProductId } = req.validatedBody;
    buildProductUrl(storeProductId); // validates format and origin

    // Check MAX_TRACKED cap
    const active = await repo.getActiveTrackedProducts(config.MAX_TRACKED + 1);
    const existing = await repo.getTrackedProductByStoreId(storeProductId);

    if (!existing && active.length >= config.MAX_TRACKED) {
      return res.status(400).json({
        error: {
          code: 'MAX_TRACKED_REACHED',
          message: `Cannot track more than ${config.MAX_TRACKED} products on the free-tier budget.`
        }
      });
    }

    // Attempt to lookup catalog product metadata
    let name = `Product ${storeProductId}`;
    let category = null;
    let imageUrl = null;
    let attributes = {};

    try {
      const { items } = await repo.searchCatalog({ query: '', limit: 100 });
      const found = items.find(it => String(it.store_product_id) === storeProductId);
      if (found) {
        name = found.name;
        category = found.category;
        imageUrl = found.image_url;
        attributes = found.attributes || {};
      }
    } catch {}

    const tracked = await repo.trackProduct({
      storeProductId,
      name,
      category,
      imageUrl,
      attributes
    });

    // Fire off async initial scrape on the background event loop
    setImmediate(async () => {
      let runId = null;
      let claimed = false;
      try {
        claimed = await repo.claimProduct(tracked.id, 120);
        console.log(`[tracked] Triggering initial background scrape for product ${storeProductId}...`);
        runId = await repo.claimManualRun('initial', 300);
        const browser = await getBrowser({ headed: false });
        await executeProductJob({
          product: tracked,
          runId,
          browser,
          persist: true
        });
        await repo.finishRun({
          runId,
          status: 'completed',
          productsTotal: 1,
          productsOk: 1,
          productsFailed: 0,
          note: 'Initial track scrape'
        });
      } catch (err) {
        console.warn(`[tracked] Initial scrape warning for product ${storeProductId}:`, err.message);
        if (runId) {
          await repo.finishRun({
            runId,
            status: 'interrupted',
            productsTotal: 1,
            productsOk: 0,
            productsFailed: 1,
            note: `Initial scrape failed: ${err.message}`
          }).catch(() => {});
        }
      } finally {
        if (claimed) {
          await repo.releaseProduct(tracked.id).catch(() => {});
        }
      }
    });

    res.status(201).json({ trackedProduct: tracked });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/tracked/:id - Soft-deactivate tracking
trackedRouter.delete('/:id', mutationRateLimiter, async (req, res, next) => {
  try {
    const { id } = req.params;
    const deactivated = await repo.deactivateTrackedProduct(id);
    res.json({ trackedProduct: deactivated });
  } catch (err) {
    next(err);
  }
});

// GET /api/tracked/:id/history - Observation time series
trackedRouter.get('/:id/history', validateQuery(historyQuerySchema), async (req, res, next) => {
  try {
    const { id } = req.params;
    const observations = await repo.getObservationHistory(id, req.validatedQuery);
    res.json({ observations });
  } catch (err) {
    next(err);
  }
});

// GET /api/tracked/:id/log - Attempt logs with cursor pagination
trackedRouter.get('/:id/log', validateQuery(logQuerySchema), async (req, res, next) => {
  try {
    const { id } = req.params;
    const attempts = await repo.getAttemptLog(id, req.validatedQuery);
    res.json({ attempts });
  } catch (err) {
    next(err);
  }
});

// POST /api/tracked/:id/scrape - Manual on-demand scrape
trackedRouter.post('/:id/scrape', manualScrapeLimiter, async (req, res, next) => {
  try {
    const { id } = req.params;
    const product = await repo.getTrackedProduct(id);
    if (!product) {
      return res.status(404).json({ error: { code: 'PRODUCT_NOT_FOUND', message: 'Tracked product not found' } });
    }

    // Try to acquire lease
    const hasLease = await repo.claimProduct(product.id, 120);
    if (!hasLease) {
      return res.status(409).json({
        error: {
          code: 'PRODUCT_LOCKED',
          message: 'This product is currently being scraped by another job or locked. Please wait.'
        }
      });
    }

    // Run scrape in background, return 202
    setImmediate(async () => {
      let runId = null;
      try {
        runId = await repo.claimManualRun('manual', 300);
        const browser = await getBrowser({ headed: false });
        await executeProductJob({
          product,
          runId,
          browser,
          persist: true
        });
        await repo.finishRun({
          runId,
          status: 'completed',
          productsTotal: 1,
          productsOk: 1,
          productsFailed: 0,
          note: 'Manual user scrape'
        });
      } catch (err) {
        console.error(`[tracked] Manual scrape failed:`, err);
        if (runId) {
          await repo.finishRun({
            runId,
            status: 'interrupted',
            productsTotal: 1,
            productsOk: 0,
            productsFailed: 1,
            note: `Manual scrape failed: ${err.message}`
          }).catch(() => {});
        }
      } finally {
        await repo.releaseProduct(product.id).catch(() => {});
      }
    });

    res.status(202).json({
      status: 'accepted',
      message: 'Scrape started in background'
    });
  } catch (err) {
    next(err);
  }
});
