/* Minimal runtime configuration for Integrations service.
 * Centralizes environment variables with sane defaults for demo.
 */

import crypto from 'crypto';

const toInt = (value: string | undefined, fallback: number): number => {
  const parsed = parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

// Derive a stable 32-byte hex encryption key if not provided, from JWT_SECRET
const DERIVED_ENCRYPTION_KEY = crypto
  .createHash('sha256')
  .update(process.env.JWT_SECRET || 'demo-secret-change-me')
  .digest('hex');

const config = {
  NODE_ENV: process.env.NODE_ENV || 'production',
  PORT: toInt(process.env.PORT, 3001),

  // Rate limiting
  RATE_LIMIT_WINDOW_MS: toInt(process.env.RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000), // 15 minutes
  RATE_LIMIT_MAX_REQUESTS: toInt(process.env.RATE_LIMIT_MAX_REQUESTS, 100),

  // Database / Redis / JWT
  DATABASE_URL: process.env.DATABASE_URL || '',
  REDIS_URL: process.env.REDIS_URL,
  JWT_SECRET: process.env.JWT_SECRET || 'demo-secret-change-me',
  ENCRYPTION_KEY: process.env.ENCRYPTION_KEY || DERIVED_ENCRYPTION_KEY,

  // Logging
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
  LOG_FILE: process.env.LOG_FILE || 'logs/app.log',

  // CORS
  FRONTEND_URL: process.env.FRONTEND_URL,
  CORS_ALLOW_ORIGINS: process.env.CORS_ALLOW_ORIGINS,
  ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS,
  ALLOWED_ORIGIN_REGEX: process.env.ALLOWED_ORIGIN_REGEX,

  // Supabase (optional for this service)
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,

  // Object storage (optional)
  S3_BUCKET: process.env.S3_BUCKET_NAME || process.env.S3_BUCKET,
  S3_REGION: process.env.S3_REGION,
  S3_PREFIX: process.env.S3_PREFIX || 'opside',

  // Stripe (not used in demo phase)
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,

  // OAuth client configuration (optional)
  GMAIL_CLIENT_ID: process.env.GMAIL_CLIENT_ID,
  GMAIL_CLIENT_SECRET: process.env.GMAIL_CLIENT_SECRET,
  GMAIL_REDIRECT_URI: process.env.GMAIL_REDIRECT_URI,
  STRIPE_CLIENT_ID: process.env.STRIPE_CLIENT_ID,
  STRIPE_CLIENT_SECRET: process.env.STRIPE_CLIENT_SECRET,
  STRIPE_REDIRECT_URI: process.env.STRIPE_REDIRECT_URI,
  GMAIL_AUTH_URL: process.env.GMAIL_AUTH_URL,
  STRIPE_AUTH_URL: process.env.STRIPE_AUTH_URL,
  // Amazon SP-API OAuth (sandbox/real)
  AMAZON_SPAPI_BASE_URL: process.env.AMAZON_SPAPI_BASE_URL,
  AMAZON_SPAPI_CLIENT_ID: process.env.AMAZON_SPAPI_CLIENT_ID,
  AMAZON_SPAPI_CLIENT_SECRET: process.env.AMAZON_SPAPI_CLIENT_SECRET,
  AMAZON_SPAPI_REDIRECT_URI: process.env.AMAZON_SPAPI_REDIRECT_URI,
  AMAZON_SPAPI_REFRESH_TOKEN: process.env.AMAZON_SPAPI_REFRESH_TOKEN,
  AMAZON_AUTH_CONSENT_URL: process.env.AMAZON_AUTH_CONSENT_URL || 'https://sellercentral.amazon.com/apps/authorize/consent',
  COOKIE_DOMAIN: process.env.COOKIE_DOMAIN,
  JWT_EXPIRES_IN: (process.env.JWT_EXPIRES_IN || '7d') as string,
};

export default config;


