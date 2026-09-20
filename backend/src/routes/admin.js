/**
 * routes/admin.js - Protected administration routes.
 */

import express from 'express';
import { requireCronAuth } from '../middleware/auth.js';
import { syncCatalog } from '../store/catalogClient.js';

export const adminRouter = express.Router();

adminRouter.post('/catalog/sync', requireCronAuth, async (req, res, next) => {
  try {
    // Run sync in background or wait
    res.status(202).json({ status: 'accepted', message: 'Catalog sync started' });
    setImmediate(async () => {
      try {
        await syncCatalog();
      } catch (err) {
        console.error('[admin] Catalog sync failed:', err);
      }
    });
  } catch (err) {
    next(err);
  }
});
