/**
 * routes/health.js - Fast health check endpoint and dead-man's switch per plan §9.4.
 */

import express from 'express';
import { repo } from '../db/repo.js';
import { isDbConfigured } from '../db/client.js';

export const healthRouter = express.Router();

healthRouter.get('/', async (req, res) => {
  const startTime = Date.now();
  let dbStats = {
    connected: false,
    lastRun: null,
    lastSuccessfulObservationAt: null,
    activeTrackedCount: 0,
    stale: false
  };

  if (isDbConfigured()) {
    try {
      // 2-second timeout for DB check
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('DB health query timed out')), 2000)
      );
      const stats = await Promise.race([repo.getHealthStats(), timeoutPromise]);
      dbStats = { connected: true, ...stats };
    } catch (dbErr) {
      console.warn(`[health] DB health check degraded: ${dbErr.message}`);
      dbStats.error = dbErr.message;
    }
  }

  const responseTimeMs = Date.now() - startTime;
  const isHealthy = dbStats.connected && !dbStats.stale;

  res.status(isHealthy ? 200 : dbStats.connected ? 200 : 503).json({
    status: isHealthy ? 'healthy' : 'degraded',
    version: '1.0.0',
    uptime: Math.round(process.uptime()),
    responseTimeMs,
    db: {
      connected: dbStats.connected,
      activeTrackedCount: dbStats.activeTrackedCount,
      lastRun: dbStats.lastRun,
      lastSuccessfulObservationAt: dbStats.lastSuccessfulObservationAt,
      stale: dbStats.stale
    }
  });
});
