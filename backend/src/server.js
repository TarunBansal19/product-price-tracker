/**
 * server.js - Express server bootstrap, middleware wiring, and lifecycle management.
 */

import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { config } from './config.js';
import { healthRouter } from './routes/health.js';
import { catalogRouter } from './routes/catalog.js';
import { trackedRouter } from './routes/tracked.js';
import { cronRouter } from './routes/cron.js';
import { adminRouter } from './routes/admin.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';
import { standardRateLimiter } from './middleware/rateLimit.js';
import { repo } from './db/repo.js';
import { isDbConfigured } from './db/client.js';
import { closeBrowser } from './store/browserPool.js';

const app = express();

// Security Hardening per §10
app.use(helmet());
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g. mobile apps, curl, cron)
      if (!origin) return callback(null, true);
      if (
        config.frontendOriginsList.includes('*') ||
        origin.endsWith('.vercel.app') ||
        origin.includes('localhost') ||
        config.frontendOriginsList.some(o => origin === o || origin.endsWith(o))
      ) {
        return callback(null, true);
      }
      return callback(null, false);
    },
    credentials: true
  })
);

app.use(express.json({ limit: '10kb' })); // Body limit 10kb
app.use(standardRateLimiter);

// API Routes
app.use('/api/health', healthRouter);
app.use('/api/catalog', catalogRouter);
app.use('/api/tracked', trackedRouter);
app.use('/api/cron', cronRouter);
app.use('/api/admin', adminRouter);

// Error Handling
app.use(notFoundHandler);
app.use(errorHandler);

// Lifecycle: Boot sweep & Server start
let server = null;

async function bootstrap() {
  console.log('=== STARTING PRODUCT PRICE TRACKER API ===');
  console.log(`Environment: ${config.NODE_ENV}`);
  console.log(`Port:        ${config.PORT}`);
  console.log(`Store:       ${config.STORE_ORIGIN}`);

  if (isDbConfigured()) {
    try {
      console.log('[boot] Running stale sweep on startup to repair interrupted state...');
      const sweep = await repo.sweepStale();
      console.log('[boot] Startup sweep completed:', sweep);
    } catch (err) {
      console.warn('[boot] Stale sweep warning:', err.message);
    }
  } else {
    console.warn('[boot] SUPABASE_URL not configured. Running in offline/degraded mode.');
  }

  server = app.listen(config.PORT, () => {
    console.log(`[server] Server running on http://localhost:${config.PORT}`);
  });
}

// Graceful Shutdown per §9.3
async function gracefulShutdown(signal) {
  console.log(`[shutdown] Received ${signal}. Starting graceful shutdown...`);
  if (server) {
    server.close(() => {
      console.log('[shutdown] HTTP server closed.');
    });
  }

  try {
    await closeBrowser();
    console.log('[shutdown] Browser pool closed.');
  } catch (err) {
    console.warn('[shutdown] Error closing browser:', err.message);
  }

  process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('unhandledRejection', (reason, promise) => {
  console.error('[fatal] Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  console.error('[fatal] Uncaught Exception:', err);
  process.exit(1);
});

bootstrap();

export { app };
