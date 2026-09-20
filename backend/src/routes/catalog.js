/**
 * routes/catalog.js - Search and inspect store catalog snapshot per plan §10.
 */

import express from 'express';
import { z } from 'zod';
import { repo } from '../db/repo.js';
import { isDbConfigured } from '../db/client.js';
import { validateQuery } from '../middleware/validate.js';
import { normalizeText } from '../store/extract/normalizeText.js';
import { fetchCatalogPage } from '../store/catalogClient.js';

export const catalogRouter = express.Router();

const searchQuerySchema = z.object({
  q: z.string().max(80).optional(),
  limit: z.coerce.number().min(1).max(50).default(20),
  offset: z.coerce.number().min(0).default(0)
});

catalogRouter.get('/search', validateQuery(searchQuerySchema), async (req, res, next) => {
  try {
    const { q = '', limit, offset } = req.validatedQuery;
    const cleanQuery = normalizeText(q).slice(0, 80);

    if (!isDbConfigured()) {
      // Fallback to live store fetch if DB is not configured (e.g. testing)
      const page = Math.floor(offset / limit) + 1;
      const data = await fetchCatalogPage({ page, pageSize: limit });
      return res.json({
        items: data.items.map(it => ({
          id: String(it.id),
          name: it.name,
          category: it.category,
          imageUrl: null,
          alreadyTracked: false
        })),
        total: data.total
      });
    }

    const { items, total } = await repo.searchCatalog({ query: cleanQuery, limit, offset });

    // Cross-check already tracked status
    const trackedList = await repo.getTrackedProducts();
    const trackedSet = new Set(trackedList.filter(t => t.is_active).map(t => String(t.store_product_id)));

    const enriched = items.map(item => ({
      id: item.store_product_id,
      name: item.name,
      category: item.category,
      imageUrl: item.image_url,
      attributes: item.attributes,
      alreadyTracked: trackedSet.has(String(item.store_product_id))
    }));

    // If snapshot is completely empty, attempt on-the-fly seed
    if (total === 0 && !cleanQuery) {
      try {
        const live = await fetchCatalogPage({ page: 1, pageSize: limit });
        if (live.items && live.items.length > 0) {
          await repo.upsertCatalogProducts(live.items);
          return res.json({
            items: live.items.map(it => ({
              id: String(it.id),
              name: it.name,
              category: it.category,
              imageUrl: null,
              alreadyTracked: trackedSet.has(String(it.id))
            })),
            total: live.total
          });
        }
      } catch {}
    }

    res.json({
      items: enriched,
      total
    });
  } catch (err) {
    next(err);
  }
});
