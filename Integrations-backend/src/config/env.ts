/* Minimal runtime configuration for Integrations service.
 * Centralizes environment variables with sane defaults for demo.
 */

import 'dotenv/config';
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
  PYTHON_API_URL: process.env.PYTHON_API_URL || 'https://clario-complete-backend-6ca7.onrender.com',

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

  // OAuth / integrations
  GMAIL_AUTH_URL: process.env.GMAIL_AUTH_URL || 'https://accounts.google.com/o/oauth2/v2/auth',
  GMAIL_CLIENT_ID: process.env.GMAIL_CLIENT_ID,
  GMAIL_CLIENT_SECRET: process.env.GMAIL_CLIENT_SECRET,
  GMAIL_REDIRECT_URI: process.env.GMAIL_REDIRECT_URI,

  // Google Drive can share the same Google OAuth app as Gmail.
  // Support both the repo's historical GDRIVE_* names and GOOGLE_DRIVE_* env names.
  GDRIVE_CLIENT_ID: process.env.GDRIVE_CLIENT_ID || process.env.GOOGLE_DRIVE_CLIENT_ID || process.env.GMAIL_CLIENT_ID,
  GDRIVE_CLIENT_SECRET: process.env.GDRIVE_CLIENT_SECRET || process.env.GOOGLE_DRIVE_CLIENT_SECRET || process.env.GMAIL_CLIENT_SECRET,
  GDRIVE_REDIRECT_URI: process.env.GDRIVE_REDIRECT_URI || process.env.GOOGLE_DRIVE_REDIRECT_URI,
  GOOGLE_DRIVE_CLIENT_ID: process.env.GOOGLE_DRIVE_CLIENT_ID || process.env.GDRIVE_CLIENT_ID || process.env.GMAIL_CLIENT_ID,
  GOOGLE_DRIVE_CLIENT_SECRET: process.env.GOOGLE_DRIVE_CLIENT_SECRET || process.env.GDRIVE_CLIENT_SECRET || process.env.GMAIL_CLIENT_SECRET,
  GOOGLE_DRIVE_REDIRECT_URI: process.env.GOOGLE_DRIVE_REDIRECT_URI || process.env.GDRIVE_REDIRECT_URI,

  // Microsoft naming compatibility
  OUTLOOK_CLIENT_ID: process.env.OUTLOOK_CLIENT_ID || process.env.MICROSOFT_CLIENT_ID,
  OUTLOOK_CLIENT_SECRET: process.env.OUTLOOK_CLIENT_SECRET || process.env.MICROSOFT_CLIENT_SECRET,
  OUTLOOK_REDIRECT_URI: process.env.OUTLOOK_REDIRECT_URI || process.env.MICROSOFT_REDIRECT_URI,
  MICROSOFT_CLIENT_ID: process.env.MICROSOFT_CLIENT_ID || process.env.OUTLOOK_CLIENT_ID,
  MICROSOFT_CLIENT_SECRET: process.env.MICROSOFT_CLIENT_SECRET || process.env.OUTLOOK_CLIENT_SECRET,
  MICROSOFT_REDIRECT_URI: process.env.MICROSOFT_REDIRECT_URI || process.env.OUTLOOK_REDIRECT_URI,

  DROPBOX_CLIENT_ID: process.env.DROPBOX_CLIENT_ID,
  DROPBOX_CLIENT_SECRET: process.env.DROPBOX_CLIENT_SECRET,
  DROPBOX_REDIRECT_URI: process.env.DROPBOX_REDIRECT_URI,

  ONEDRIVE_CLIENT_ID: process.env.ONEDRIVE_CLIENT_ID,
  ONEDRIVE_CLIENT_SECRET: process.env.ONEDRIVE_CLIENT_SECRET,
  ONEDRIVE_REDIRECT_URI: process.env.ONEDRIVE_REDIRECT_URI,

  ADOBESIGN_CLIENT_ID: process.env.ADOBESIGN_CLIENT_ID,
  ADOBESIGN_CLIENT_SECRET: process.env.ADOBESIGN_CLIENT_SECRET,
  ADOBESIGN_REDIRECT_URI: process.env.ADOBESIGN_REDIRECT_URI,

  SLACK_CLIENT_ID: process.env.SLACK_CLIENT_ID,
  SLACK_CLIENT_SECRET: process.env.SLACK_CLIENT_SECRET,
  SLACK_REDIRECT_URI: process.env.SLACK_REDIRECT_URI,
  SLACK_SIGNING_SECRET: process.env.SLACK_SIGNING_SECRET,
  SLACK_VERIFICATION_TOKEN: process.env.SLACK_VERIFICATION_TOKEN,
  SLACK_BOT_USER_OAUTH_TOKEN: process.env.SLACK_BOT_USER_OAUTH_TOKEN || process.env.BOT_USER_OAUTH_TOKEN,

  STRIPE_AUTH_URL: process.env.STRIPE_AUTH_URL,
  STRIPE_CLIENT_ID: process.env.STRIPE_CLIENT_ID,
  STRIPE_CLIENT_SECRET: process.env.STRIPE_CLIENT_SECRET,
  STRIPE_REDIRECT_URI: process.env.STRIPE_REDIRECT_URI,

  // Supabase (optional for this service)
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,

  // Object storage (optional)
  S3_BUCKET: process.env.S3_BUCKET_NAME || process.env.S3_BUCKET,
  S3_REGION: process.env.S3_REGION,
  S3_PREFIX: process.env.S3_PREFIX || 'opside',

  // PayPal is the exclusive billing provider
  PAYPAL_CLIENT_ID: process.env.PAYPAL_CLIENT_ID,
  PAYPAL_CLIENT_SECRET: process.env.PAYPAL_CLIENT_SECRET,
  PAYPAL_WEBHOOK_ID: process.env.PAYPAL_WEBHOOK_ID,

  // Sync configuration
  SYNC_TIMEOUT_MS: toInt(process.env.SYNC_TIMEOUT_MS, 10 * 60 * 1000),

  // AI explainer
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  AI_EXPLAINER_ENABLED: process.env.AI_EXPLAINER_ENABLED || 'false',
  AI_EXPLAINER_MODEL: process.env.AI_EXPLAINER_MODEL || 'gpt-4.1-nano',
  AI_EXPLAINER_TIMEOUT_MS: toInt(process.env.AI_EXPLAINER_TIMEOUT_MS, 8000),

  // Waitlist capture
  WAITLIST_CAPTURE_EMAIL: process.env.WAITLIST_CAPTURE_EMAIL || 'support@margin-finance.com',
  EARLY_ACCESS_CAPTURE_EMAIL: process.env.EARLY_ACCESS_CAPTURE_EMAIL || process.env.WAITLIST_CAPTURE_EMAIL || 'support@margin-finance.com',
};

export default config;


