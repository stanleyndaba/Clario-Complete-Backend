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
  PYTHON_API_URL: process.env.PYTHON_API_URL || 'https://python-api-9.onrender.com',

  // Rate limiting
  RATE_LIMIT_WINDOW_MS: toInt(process.env.RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000), // 15 minutes
  RATE_LIMIT_MAX_REQUESTS: toInt(process.env.RATE_LIMIT_MAX_REQUESTS, 100),

  // Database / Redis / JWT
  DATABASE_URL: process.env.DATABASE_URL || '',
  REDIS_URL: process.env.REDIS_URL,
  JWT_SECRET: process.env.JWT_SECRET || 'demo-secret-change-me',
  PYTHON_API_JWT_SECRET: process.env.PYTHON_API_JWT_SECRET || process.env.JWT_SECRET || '',
  PYTHON_API_JWT_TTL: process.env.PYTHON_API_JWT_TTL || '5m',
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
  GDRIVE_CLIENT_ID: process.env.GDRIVE_CLIENT_ID,
  GDRIVE_CLIENT_SECRET: process.env.GDRIVE_CLIENT_SECRET,
  GDRIVE_REDIRECT_URI: process.env.GDRIVE_REDIRECT_URI,
  OUTLOOK_CLIENT_ID: process.env.OUTLOOK_CLIENT_ID,
  OUTLOOK_CLIENT_SECRET: process.env.OUTLOOK_CLIENT_SECRET,
  OUTLOOK_REDIRECT_URI: process.env.OUTLOOK_REDIRECT_URI,
  DROPBOX_CLIENT_ID: process.env.DROPBOX_CLIENT_ID,
  DROPBOX_CLIENT_SECRET: process.env.DROPBOX_CLIENT_SECRET,
  DROPBOX_REDIRECT_URI: process.env.DROPBOX_REDIRECT_URI,
  STRIPE_CLIENT_ID: process.env.STRIPE_CLIENT_ID,
  STRIPE_CLIENT_SECRET: process.env.STRIPE_CLIENT_SECRET,
  STRIPE_REDIRECT_URI: process.env.STRIPE_REDIRECT_URI,
  GMAIL_AUTH_URL: process.env.GMAIL_AUTH_URL,
  STRIPE_AUTH_URL: process.env.STRIPE_AUTH_URL,
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '7d',

  // Amazon SP-API Mock Data Generator (Phase 1 Testing)
  // Enable mock data generator when sandbox returns empty data
  USE_MOCK_DATA_GENERATOR: process.env.USE_MOCK_DATA_GENERATOR !== 'false', // Default: true
  MOCK_SCENARIO: (process.env.MOCK_SCENARIO as 'normal_week' | 'high_volume' | 'with_issues') || 'normal_week',
  MOCK_RECORD_COUNT: process.env.MOCK_RECORD_COUNT ? parseInt(process.env.MOCK_RECORD_COUNT, 10) : 75, // Default: 75 (50-100 range)
};

export default config;


