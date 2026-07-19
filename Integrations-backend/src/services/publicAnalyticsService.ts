import { Pool } from 'pg';
import type { Request } from 'express';

import logger from '../utils/logger';

type PublicAnalyticsRequestBody = {
  name?: unknown;
  payload?: unknown;
};

const MAX_STRING_LENGTH = 2000;
const MAX_ARRAY_LENGTH = 50;
const SENSITIVE_KEYS = new Set([
  'email',
  'user_email',
  'seller_central_email',
  'password',
  'token',
  'auth_token',
  'access_token',
  'refresh_token',
  'authorization',
]);

let pool: Pool | null = null;
let schemaReady: Promise<void> | null = null;
let warnedMissingDatabaseUrl = false;

function getAnalyticsPool() {
  if (pool) return pool;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    if (!warnedMissingDatabaseUrl) {
      warnedMissingDatabaseUrl = true;
      logger.warn('[PUBLIC ANALYTICS] DATABASE_URL missing; metrics will only be logged');
    }
    return null;
  }

  pool = new Pool({
    connectionString,
    ssl: connectionString.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined,
    max: 2,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });

  return pool;
}

function sanitizeAnalyticsValue(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[max_depth]';
  if (value === null || value === undefined) return value;

  if (typeof value === 'string') {
    return value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}...[truncated]` : value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') return value;

  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_LENGTH).map((item) => sanitizeAnalyticsValue(item, depth + 1));
  }

  if (typeof value === 'object') {
    const output: Record<string, unknown> = {};
    Object.entries(value as Record<string, unknown>).forEach(([key, nestedValue]) => {
      const normalizedKey = key.trim().toLowerCase();
      output[key] = SENSITIVE_KEYS.has(normalizedKey)
        ? '[redacted]'
        : sanitizeAnalyticsValue(nestedValue, depth + 1);
    });
    return output;
  }

  return String(value);
}

function getStringPayloadValue(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 500) : null;
}

async function ensurePublicAnalyticsSchema() {
  const analyticsPool = getAnalyticsPool();
  if (!analyticsPool) return;

  if (!schemaReady) {
    schemaReady = analyticsPool.query(`
      CREATE TABLE IF NOT EXISTS public_analytics_events (
        id BIGSERIAL PRIMARY KEY,
        event_name TEXT NOT NULL,
        event_id TEXT,
        anonymous_id TEXT,
        analytics_session_id TEXT,
        user_id TEXT,
        user_email_domain TEXT,
        active_tenant_slug TEXT,
        page_path TEXT,
        page_location TEXT,
        traffic_source_hint TEXT,
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        ip_address TEXT,
        user_agent TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_public_analytics_events_event_name_created
        ON public_analytics_events(event_name, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_public_analytics_events_anon_created
        ON public_analytics_events(anonymous_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_public_analytics_events_session_created
        ON public_analytics_events(analytics_session_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_public_analytics_events_page_created
        ON public_analytics_events(page_path, created_at DESC);
    `).then(() => undefined);
  }

  await schemaReady;
}

function getClientIp(req: Request) {
  const forwardedFor = req.headers['x-forwarded-for'];
  if (typeof forwardedFor === 'string' && forwardedFor.trim()) {
    return forwardedFor.split(',')[0]?.trim() || null;
  }
  if (Array.isArray(forwardedFor) && forwardedFor[0]) {
    return forwardedFor[0].split(',')[0]?.trim() || null;
  }
  return req.ip || null;
}

export async function recordPublicAnalyticsEvent(body: PublicAnalyticsRequestBody, req: Request) {
  const eventName = typeof body?.name === 'string' && body.name.trim()
    ? body.name.trim().slice(0, 120)
    : 'unknown_event';

  const sanitizedPayload = sanitizeAnalyticsValue(body?.payload || {}) as Record<string, unknown>;

  logger.info('[PUBLIC ANALYTICS] Event received', {
    eventName,
    pagePath: getStringPayloadValue(sanitizedPayload, 'page_path'),
    trafficSource: getStringPayloadValue(sanitizedPayload, 'traffic_source_hint'),
  });

  const analyticsPool = getAnalyticsPool();
  if (!analyticsPool) return;

  try {
    await ensurePublicAnalyticsSchema();
    await analyticsPool.query(
      `
        INSERT INTO public_analytics_events (
          event_name,
          event_id,
          anonymous_id,
          analytics_session_id,
          user_id,
          user_email_domain,
          active_tenant_slug,
          page_path,
          page_location,
          traffic_source_hint,
          payload,
          ip_address,
          user_agent
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13)
      `,
      [
        eventName,
        getStringPayloadValue(sanitizedPayload, 'event_id'),
        getStringPayloadValue(sanitizedPayload, 'anonymous_id'),
        getStringPayloadValue(sanitizedPayload, 'analytics_session_id'),
        getStringPayloadValue(sanitizedPayload, 'user_id'),
        getStringPayloadValue(sanitizedPayload, 'user_email_domain'),
        getStringPayloadValue(sanitizedPayload, 'active_tenant_slug'),
        getStringPayloadValue(sanitizedPayload, 'page_path'),
        getStringPayloadValue(sanitizedPayload, 'page_location'),
        getStringPayloadValue(sanitizedPayload, 'traffic_source_hint'),
        JSON.stringify(sanitizedPayload),
        getClientIp(req),
        typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'].slice(0, 1000) : null,
      ],
    );
  } catch (error) {
    logger.warn('[PUBLIC ANALYTICS] Failed to persist event; continuing without blocking request', {
      eventName,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
