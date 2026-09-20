/**
 * middleware/auth.js - Bearer token validation with constant-time comparison.
 * Protects cron and admin routes against timing attacks.
 */

import crypto from 'node:crypto';
import { config } from '../config.js';

export function requireCronAuth(req, res, next) {
  const authHeader = req.headers['authorization'] || '';
  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: { code: 'UNAUTHORIZED', message: 'Missing or malformed Authorization header' }
    });
  }

  const token = authHeader.slice(7).trim();
  const secret = config.CRON_SECRET;

  if (!secret) {
    console.error('[auth] CRON_SECRET is not configured on server');
    return res.status(500).json({
      error: { code: 'SERVER_MISCONFIGURED', message: 'Auth secret not configured' }
    });
  }

  const tokenBuf = Buffer.from(token, 'utf-8');
  const secretBuf = Buffer.from(secret, 'utf-8');

  // Constant-time compare
  if (tokenBuf.length !== secretBuf.length || !crypto.timingSafeEqual(tokenBuf, secretBuf)) {
    return res.status(401).json({
      error: { code: 'UNAUTHORIZED', message: 'Invalid credentials' }
    });
  }

  next();
}
