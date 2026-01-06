import 'dotenv/config';

function parseNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value.toLowerCase() === 'true';
}

const config = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
  LOG_FILE_PATH: process.env.LOG_FILE_PATH || 'logs/stripe-payments.log',
  REDIS_URL: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
  JWT_SECRET: process.env.JWT_SECRET || 'test-secret',

  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || 'sk_test_dummy',
  STRIPE_API_VERSION: process.env.STRIPE_API_VERSION || '2023-10-16',
  STRIPE_PLATFORM_ACCOUNT_ID: process.env.STRIPE_PLATFORM_ACCOUNT_ID || 'acct_test',
  STRIPE_CLIENT_ID: process.env.STRIPE_CLIENT_ID || 'ca_test',
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET || 'whsec_test',
  STRIPE_PRICE_ID: process.env.STRIPE_PRICE_ID || 'price_test',
  STRIPE_LIVE_MODE: parseBoolean(process.env.STRIPE_LIVE_MODE, false),

  PLATFORM_FEE_PERCENTAGE: parseNumber(process.env.PLATFORM_FEE_PERCENTAGE, 20),

  RATE_LIMIT_WINDOW_MS: parseNumber(process.env.RATE_LIMIT_WINDOW_MS, 60_000),
  RATE_LIMIT_MAX_REQUESTS: parseNumber(process.env.RATE_LIMIT_MAX_REQUESTS, 100),
  IDEMPOTENCY_TTL_SECONDS: parseNumber(process.env.IDEMPOTENCY_TTL_SECONDS, 60 * 60 * 24),
};

export default config;

