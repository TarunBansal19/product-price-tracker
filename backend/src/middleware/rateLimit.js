/**
 * middleware/rateLimit.js - Rate limiting for API endpoints.
 */

import rateLimit from 'express-rate-limit';

export const standardRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60, // 60 requests per minute
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: { code: 'RATE_LIMITED', message: 'Too many requests, please slow down.' }
  }
});

export const mutationRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 15, // 15 mutations per minute
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: { code: 'RATE_LIMITED', message: 'Too many mutation requests. Please wait.' }
  }
});

export const manualScrapeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5, // max 5 manual scrapes per minute
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: { code: 'RATE_LIMITED', message: 'Manual scrape cooldown: please wait 60s.' }
  }
});
