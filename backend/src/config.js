import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3001),
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  CRON_SECRET: z.string().min(8).default('test-cron-secret-please-change-in-production'),
  FRONTEND_ORIGINS: z.string().default('http://localhost:5173,http://localhost:3000'),
  STORE_ORIGIN: z.string().url().default('https://demo.inelabteamdev.com'),
  MAX_TRACKED: z.coerce.number().default(15),
  SCRAPE_INTERVAL_HOURS: z.coerce.number().default(2),
  ATTEMPT_TIMEOUT_MS: z.coerce.number().default(30000),
  MAX_ATTEMPTS: z.coerce.number().default(4),
  BACKOFF_BASE_MS: z.coerce.number().default(1500),
  BACKOFF_MAX_MS: z.coerce.number().default(15000),
  JOB_DEADLINE_MS: z.coerce.number().default(120000),
  RUN_DEADLINE_MS: z.coerce.number().default(1500000),
  CONCURRENCY: z.coerce.number().default(1),
  STABILITY_MS: z.coerce.number().default(2000),
  OUTLIER_PCT: z.coerce.number().default(35),
  HEADED: z.preprocess(v => v === 'true' || v === '1', z.boolean().default(false)),
  SLOW_MO_MS: z.coerce.number().default(0),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info')
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('Environment configuration error:');
  console.error(JSON.stringify(parsed.error.format(), null, 2));
  process.exit(1);
}

export const config = {
  ...parsed.data,
  frontendOriginsList: parsed.data.FRONTEND_ORIGINS.split(',').map(o => o.trim()).filter(Boolean)
};
