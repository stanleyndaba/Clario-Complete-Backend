import crypto from 'crypto';
import { Pool, type PoolClient } from 'pg';
import type { Request } from 'express';

import {
  buildIntentSummary,
  getHighestIntentStage,
  getIntentStage,
  getRecoveryIntentSignals,
  type IntentSignal,
} from './recoveryIntentScoringService';
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
let intentMaintenanceRunning = false;

const BOT_USER_AGENT_PATTERN =
  /(bot|crawler|spider|preview|facebookexternalhit|facebot|twitterbot|slackbot|linkedinbot|whatsapp|telegrambot|googlebot|bingbot|duckduckbot|yandex|baiduspider|semrushbot|ahrefsbot|petalbot|headlesschrome|phantomjs|python-requests|curl|wget)/i;
const BOT_USER_AGENT_SQL_PATTERN =
  'bot|crawler|spider|preview|facebookexternalhit|facebot|twitterbot|slackbot|linkedinbot|whatsapp|telegrambot|googlebot|bingbot|duckduckbot|yandex|baiduspider|semrushbot|ahrefsbot|petalbot|headlesschrome|phantomjs|python-requests|curl|wget';
const INTERNAL_TEST_SQL =
  `(COALESCE(is_internal_test, false) OR COALESCE(payload->>'is_internal_test', 'false') = 'true')`;
const LIKELY_BOT_SQL =
  `(COALESCE(is_likely_bot, false) OR COALESCE(user_agent, '') ~* '${BOT_USER_AGENT_SQL_PATTERN}')`;

const FUNNEL_EVENT_NAMES = [
  'page_view',
  'public_page_viewed',
  'homepage_viewed',
  'early_access_viewed',
  'early_access_hero_seen',
  'early_access_offer_seen',
  'early_access_cta_seen',
  'paystack_cta_seen',
  'claim_access_clicked',
  'checkout_started',
  'outbound_payment_clicked',
  'payment_success',
  'app_gate_viewed',
  'login_attempt',
  'reviewer_login_success',
];

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
    connectionTimeoutMillis: 15_000,
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

function getBooleanPayloadValue(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.toLowerCase() === 'true';
  return false;
}

function getHeaderValue(req: Request, headers: string[]) {
  for (const header of headers) {
    const value = req.headers[header.toLowerCase()];
    if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 100);
    if (Array.isArray(value) && value[0]) return String(value[0]).trim().slice(0, 100);
  }
  return null;
}

function normalizeEventDay(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function isLikelyBotUserAgent(userAgent: string | null) {
  return Boolean(userAgent && BOT_USER_AGENT_PATTERN.test(userAgent));
}

function getDeviceShape(userAgent: string | null) {
  if (!userAgent) return 'unknown';
  if (isLikelyBotUserAgent(userAgent)) return 'bot_or_preview';
  if (/mobile|iphone|android|ipad|tablet/i.test(userAgent)) return 'mobile';
  return 'desktop_or_tablet';
}

function getRouteGroup(pagePath: string | null) {
  if (!pagePath) return null;

  const pathname = pagePath.split('?')[0] || pagePath;
  if (pathname === '/') return 'home';
  if (pathname === '/app') return 'app_gate';
  if (pathname.startsWith('/app/demo-workspace')) return 'demo_app';
  if (pathname.startsWith('/app/')) return 'app';
  if (pathname === '/login') return 'login';
  if (pathname === '/early-access') return 'early_access';
  if (pathname === '/pricing') return 'pricing';
  if (pathname === '/payment-success') return 'payment_success';
  if (pathname === '/waitlist') return 'waitlist';
  if (pathname === '/contact') return 'contact';
  if (pathname === '/about-margin') return 'about';
  return 'public_site';
}

function getReferrerHost(payload: Record<string, unknown>) {
  const referrer = getStringPayloadValue(payload, 'referrer');
  if (referrer) {
    try {
      return new URL(referrer).hostname.slice(0, 255);
    } catch {
      return referrer.replace(/^https?:\/\//, '').split('/')[0].slice(0, 255);
    }
  }

  const trafficSourceHint = getStringPayloadValue(payload, 'traffic_source_hint');
  if (trafficSourceHint?.startsWith('referrer:')) {
    return trafficSourceHint.replace(/^referrer:/, '').slice(0, 255);
  }

  return null;
}

function getSourceType(payload: Record<string, unknown>, referrerHost: string | null) {
  if (getBooleanPayloadValue(payload, 'is_internal_test')) return 'internal_test';
  if (getStringPayloadValue(payload, 'utm_source')) return 'utm';
  if (referrerHost) return 'referral';
  if (getBooleanPayloadValue(payload, 'is_demo_session')) return 'demo_session';
  return 'direct_or_unknown';
}

function getClientIpHash(ipAddress: string | null) {
  if (!ipAddress) return null;
  const salt = process.env.ANALYTICS_IP_HASH_SALT || process.env.JWT_SECRET || 'margin-public-analytics';
  return crypto.createHash('sha256').update(`${salt}:${ipAddress}`).digest('hex');
}

function getGeoCountry(req: Request) {
  return getHeaderValue(req, [
    'cf-ipcountry',
    'x-vercel-ip-country',
    'x-country-code',
    'x-client-country',
  ]);
}

function buildDerivedAnalyticsFields(
  payload: Record<string, unknown>,
  req: Request,
  clientIp: string | null,
) {
  const userAgent = typeof req.headers['user-agent'] === 'string'
    ? req.headers['user-agent'].slice(0, 1000)
    : null;
  const pagePath = getStringPayloadValue(payload, 'page_path');
  const referrerHost = getReferrerHost(payload);
  const isInternalTest = getBooleanPayloadValue(payload, 'is_internal_test');

  return {
    eventDay: normalizeEventDay(),
    sourceType: getSourceType(payload, referrerHost),
    deviceShape: getDeviceShape(userAgent),
    routeGroup: getRouteGroup(pagePath),
    referrerHost,
    utmSource: getStringPayloadValue(payload, 'utm_source'),
    utmMedium: getStringPayloadValue(payload, 'utm_medium'),
    utmCampaign: getStringPayloadValue(payload, 'utm_campaign'),
    geoCountry: getGeoCountry(req),
    ipHash: getClientIpHash(clientIp),
    isInternalTest,
    isDemoSession: getBooleanPayloadValue(payload, 'is_demo_session'),
    isLikelyBot: !isInternalTest && isLikelyBotUserAgent(userAgent),
    userAgent,
  };
}

function isTransientPostgresLockError(error: unknown) {
  const pgCode = typeof error === 'object' && error && 'code' in error
    ? String((error as { code?: unknown }).code || '')
    : '';
  const message = error instanceof Error ? error.message : String(error || '');
  return pgCode === '40P01' || /deadlock detected|lock timeout/i.test(message);
}

function wait(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function ensurePublicAnalyticsSchema() {
  const analyticsPool = getAnalyticsPool();
  if (!analyticsPool) return;

  const runSchemaSetup = () => analyticsPool.query(`
      CREATE TABLE IF NOT EXISTS public_analytics_events (
        id BIGSERIAL PRIMARY KEY,
        event_name TEXT NOT NULL,
        event_id TEXT,
        event_day DATE,
        anonymous_id TEXT,
        analytics_session_id TEXT,
        user_id TEXT,
        user_email_domain TEXT,
        active_tenant_slug TEXT,
        page_path TEXT,
        page_location TEXT,
        traffic_source_hint TEXT,
        source_type TEXT,
        device_shape TEXT,
        route_group TEXT,
        referrer_host TEXT,
        utm_source TEXT,
        utm_medium TEXT,
        utm_campaign TEXT,
        geo_country TEXT,
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        ip_hash TEXT,
        ip_address TEXT,
        user_agent TEXT,
        is_internal_test BOOLEAN NOT NULL DEFAULT false,
        is_demo_session BOOLEAN NOT NULL DEFAULT false,
        is_likely_bot BOOLEAN NOT NULL DEFAULT false,
        session_intent_score INTEGER,
        visitor_intent_score INTEGER,
        intent_stage TEXT,
        highest_intent_stage TEXT,
        highest_intent_score INTEGER,
        last_intent_update TIMESTAMPTZ,
        intent_summary JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      ALTER TABLE public_analytics_events
        ADD COLUMN IF NOT EXISTS event_day DATE,
        ADD COLUMN IF NOT EXISTS source_type TEXT,
        ADD COLUMN IF NOT EXISTS device_shape TEXT,
        ADD COLUMN IF NOT EXISTS route_group TEXT,
        ADD COLUMN IF NOT EXISTS referrer_host TEXT,
        ADD COLUMN IF NOT EXISTS utm_source TEXT,
        ADD COLUMN IF NOT EXISTS utm_medium TEXT,
        ADD COLUMN IF NOT EXISTS utm_campaign TEXT,
        ADD COLUMN IF NOT EXISTS geo_country TEXT,
        ADD COLUMN IF NOT EXISTS ip_hash TEXT,
        ADD COLUMN IF NOT EXISTS is_internal_test BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS is_demo_session BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS is_likely_bot BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS session_intent_score INTEGER,
        ADD COLUMN IF NOT EXISTS visitor_intent_score INTEGER,
        ADD COLUMN IF NOT EXISTS intent_stage TEXT,
        ADD COLUMN IF NOT EXISTS highest_intent_stage TEXT,
        ADD COLUMN IF NOT EXISTS highest_intent_score INTEGER,
        ADD COLUMN IF NOT EXISTS last_intent_update TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS intent_summary JSONB;

      CREATE TABLE IF NOT EXISTS public_analytics_session_intent (
        analytics_session_id TEXT PRIMARY KEY,
        anonymous_id TEXT,
        session_intent_score INTEGER NOT NULL DEFAULT 0,
        intent_stage TEXT NOT NULL DEFAULT 'COLD',
        highest_intent_stage TEXT NOT NULL DEFAULT 'COLD',
        highest_intent_score INTEGER NOT NULL DEFAULT 0,
        intent_summary JSONB NOT NULL DEFAULT '{"score":0,"stage":"COLD","reasons":[]}'::jsonb,
        scored_reasons JSONB NOT NULL DEFAULT '{}'::jsonb,
        first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_intent_update TIMESTAMPTZ,
        event_count INTEGER NOT NULL DEFAULT 0,
        page_views INTEGER NOT NULL DEFAULT 0,
        last_event_name TEXT,
        last_page_path TEXT,
        is_internal_test BOOLEAN NOT NULL DEFAULT false,
        is_likely_bot BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS public_analytics_visitor_intent (
        anonymous_id TEXT PRIMARY KEY,
        visitor_intent_score INTEGER NOT NULL DEFAULT 0,
        intent_stage TEXT NOT NULL DEFAULT 'COLD',
        highest_intent_stage TEXT NOT NULL DEFAULT 'COLD',
        highest_intent_score INTEGER NOT NULL DEFAULT 0,
        intent_summary JSONB NOT NULL DEFAULT '{"score":0,"stage":"COLD","reasons":[]}'::jsonb,
        scored_reasons JSONB NOT NULL DEFAULT '{}'::jsonb,
        first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_intent_update TIMESTAMPTZ,
        session_count INTEGER NOT NULL DEFAULT 0,
        event_count INTEGER NOT NULL DEFAULT 0,
        page_views INTEGER NOT NULL DEFAULT 0,
        last_event_name TEXT,
        last_page_path TEXT,
        is_likely_bot BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_public_analytics_events_event_name_created
        ON public_analytics_events(event_name, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_public_analytics_events_event_day
        ON public_analytics_events(event_day DESC);
      CREATE INDEX IF NOT EXISTS idx_public_analytics_events_event_day_name
        ON public_analytics_events(event_day DESC, event_name);
      CREATE INDEX IF NOT EXISTS idx_public_analytics_events_anon_created
        ON public_analytics_events(anonymous_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_public_analytics_events_session_created
        ON public_analytics_events(analytics_session_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_public_analytics_events_page_created
        ON public_analytics_events(page_path, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_public_analytics_events_route_day
        ON public_analytics_events(route_group, event_day DESC);
      CREATE INDEX IF NOT EXISTS idx_public_analytics_events_source_day
        ON public_analytics_events(source_type, event_day DESC);
      CREATE INDEX IF NOT EXISTS idx_public_analytics_events_bot_day
        ON public_analytics_events(is_likely_bot, event_day DESC);
      CREATE INDEX IF NOT EXISTS idx_public_analytics_events_intent_stage_day
        ON public_analytics_events(intent_stage, event_day DESC);
      CREATE INDEX IF NOT EXISTS idx_public_analytics_events_visitor_intent
        ON public_analytics_events(anonymous_id, visitor_intent_score DESC);

      CREATE INDEX IF NOT EXISTS idx_public_analytics_session_intent_score
        ON public_analytics_session_intent(session_intent_score DESC);
      CREATE INDEX IF NOT EXISTS idx_public_analytics_session_intent_stage
        ON public_analytics_session_intent(intent_stage, last_seen DESC);
      CREATE INDEX IF NOT EXISTS idx_public_analytics_visitor_intent_score
        ON public_analytics_visitor_intent(visitor_intent_score DESC);
      CREATE INDEX IF NOT EXISTS idx_public_analytics_visitor_intent_stage
        ON public_analytics_visitor_intent(intent_stage, last_seen DESC);

      UPDATE public_analytics_events
      SET
        event_day = COALESCE(event_day, (created_at AT TIME ZONE 'UTC')::date),
        device_shape = COALESCE(
          device_shape,
          CASE
            WHEN COALESCE(user_agent, '') ~* '${BOT_USER_AGENT_SQL_PATTERN}' THEN 'bot_or_preview'
            WHEN COALESCE(user_agent, '') ~* 'mobile|iphone|android|ipad|tablet' THEN 'mobile'
            WHEN user_agent IS NULL THEN 'unknown'
            ELSE 'desktop_or_tablet'
          END
        ),
        route_group = COALESCE(
          route_group,
          CASE
            WHEN page_path IS NULL THEN NULL
            WHEN split_part(page_path, '?', 1) = '/' THEN 'home'
            WHEN split_part(page_path, '?', 1) = '/app' THEN 'app_gate'
            WHEN split_part(page_path, '?', 1) LIKE '/app/demo-workspace%' THEN 'demo_app'
            WHEN split_part(page_path, '?', 1) LIKE '/app/%' THEN 'app'
            WHEN split_part(page_path, '?', 1) = '/login' THEN 'login'
            WHEN split_part(page_path, '?', 1) = '/early-access' THEN 'early_access'
            WHEN split_part(page_path, '?', 1) = '/pricing' THEN 'pricing'
            WHEN split_part(page_path, '?', 1) = '/payment-success' THEN 'payment_success'
            WHEN split_part(page_path, '?', 1) = '/waitlist' THEN 'waitlist'
            WHEN split_part(page_path, '?', 1) = '/contact' THEN 'contact'
            WHEN split_part(page_path, '?', 1) = '/about-margin' THEN 'about'
            ELSE 'public_site'
          END
        ),
        referrer_host = COALESCE(
          referrer_host,
          CASE
            WHEN traffic_source_hint LIKE 'referrer:%' THEN LEFT(REPLACE(traffic_source_hint, 'referrer:', ''), 255)
            ELSE NULL
          END
        ),
        utm_source = COALESCE(utm_source, NULLIF(payload->>'utm_source', '')),
        utm_medium = COALESCE(utm_medium, NULLIF(payload->>'utm_medium', '')),
        utm_campaign = COALESCE(utm_campaign, NULLIF(payload->>'utm_campaign', '')),
        source_type = COALESCE(
          source_type,
          CASE
            WHEN COALESCE(payload->>'is_internal_test', 'false') = 'true' THEN 'internal_test'
            WHEN NULLIF(payload->>'utm_source', '') IS NOT NULL THEN 'utm'
            WHEN traffic_source_hint LIKE 'referrer:%' OR NULLIF(payload->>'referrer', '') IS NOT NULL THEN 'referral'
            WHEN COALESCE(payload->>'is_demo_session', 'false') = 'true' THEN 'demo_session'
            ELSE 'direct_or_unknown'
          END
        ),
        is_internal_test = CASE
          WHEN COALESCE(payload->>'is_internal_test', 'false') = 'true' THEN true
          ELSE COALESCE(is_internal_test, false)
        END,
        is_demo_session = CASE
          WHEN COALESCE(payload->>'is_demo_session', 'false') = 'true' THEN true
          ELSE COALESCE(is_demo_session, false)
        END,
        is_likely_bot = CASE
          WHEN COALESCE(user_agent, '') ~* '${BOT_USER_AGENT_SQL_PATTERN}' THEN true
          ELSE COALESCE(is_likely_bot, false)
        END
      WHERE event_day IS NULL
        OR device_shape IS NULL
        OR (page_path IS NOT NULL AND route_group IS NULL)
        OR source_type IS NULL
        OR (traffic_source_hint LIKE 'referrer:%' AND referrer_host IS NULL)
        OR (NULLIF(payload->>'utm_source', '') IS NOT NULL AND utm_source IS NULL)
        OR (NULLIF(payload->>'utm_medium', '') IS NOT NULL AND utm_medium IS NULL)
        OR (NULLIF(payload->>'utm_campaign', '') IS NOT NULL AND utm_campaign IS NULL)
        OR COALESCE(payload->>'is_internal_test', 'false') = 'true'
        OR COALESCE(payload->>'is_demo_session', 'false') = 'true'
        OR (COALESCE(user_agent, '') ~* '${BOT_USER_AGENT_SQL_PATTERN}' AND NOT COALESCE(is_likely_bot, false));

      CREATE OR REPLACE VIEW public_analytics_daily_rollup AS
      SELECT
        COALESCE(event_day, (created_at AT TIME ZONE 'UTC')::date) AS event_day,
        COUNT(*)::int AS total_events,
        COUNT(*) FILTER (WHERE event_name = 'page_view')::int AS page_views,
        COUNT(DISTINCT analytics_session_id) FILTER (WHERE analytics_session_id IS NOT NULL)::int AS sessions,
        COUNT(DISTINCT anonymous_id) FILTER (WHERE anonymous_id IS NOT NULL)::int AS anonymous_visitors,
        COUNT(DISTINCT analytics_session_id) FILTER (
          WHERE analytics_session_id IS NOT NULL
            AND NOT ${LIKELY_BOT_SQL}
            AND NOT ${INTERNAL_TEST_SQL}
        )::int AS likely_human_sessions,
        COUNT(DISTINCT anonymous_id) FILTER (
          WHERE anonymous_id IS NOT NULL
            AND NOT ${LIKELY_BOT_SQL}
            AND NOT ${INTERNAL_TEST_SQL}
        )::int AS likely_human_visitors,
        COUNT(DISTINCT analytics_session_id) FILTER (
          WHERE analytics_session_id IS NOT NULL
            AND ${LIKELY_BOT_SQL}
        )::int AS bot_or_preview_sessions,
        COUNT(*) FILTER (WHERE event_name = 'checkout_started')::int AS checkout_started,
        COUNT(*) FILTER (WHERE event_name = 'claim_access_clicked')::int AS claim_access_clicked,
        COUNT(*) FILTER (WHERE event_name = 'outbound_payment_clicked')::int AS outbound_payment_clicked,
        COUNT(*) FILTER (WHERE event_name = 'app_gate_viewed')::int AS app_gate_viewed
      FROM public_analytics_events
      GROUP BY COALESCE(event_day, (created_at AT TIME ZONE 'UTC')::date);
    `).then(() => undefined);

  if (!schemaReady) {
    schemaReady = runSchemaSetup();
  }

  try {
    await schemaReady;
  } catch (error) {
    schemaReady = null;
    if (!isTransientPostgresLockError(error)) throw error;

    logger.warn('[PUBLIC ANALYTICS] Schema setup hit a transient lock conflict; retrying once', {
      error: error instanceof Error ? error.message : String(error),
    });

    await wait(750);
    schemaReady = runSchemaSetup();
    await schemaReady;
  }
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

type IntentAccumulatorRow = {
  score: number;
  stage: string;
  highestScore: number;
  highestStage: string;
  scoredReasons: Record<string, unknown>;
  summary: Record<string, unknown>;
};

type IntentSnapshot = {
  session?: IntentAccumulatorRow;
  visitor?: IntentAccumulatorRow;
};

function normalizeScoredReasons(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function toIntentAccumulatorRow(row: any, scoreColumn: 'session_intent_score' | 'visitor_intent_score'): IntentAccumulatorRow {
  const score = Number(row?.[scoreColumn] || 0);
  const stage = String(row?.intent_stage || getIntentStage(score));
  const highestScore = Number(row?.highest_intent_score ?? Math.max(0, score));
  const highestStage = String(row?.highest_intent_stage || getIntentStage(highestScore));
  const scoredReasons = normalizeScoredReasons(row?.scored_reasons);

  return {
    score,
    stage,
    highestScore,
    highestStage,
    scoredReasons,
    summary: buildIntentSummary(score, getIntentStage(score), scoredReasons),
  };
}

function applySignalsToAccumulator(
  accumulator: IntentAccumulatorRow,
  signals: IntentSignal[],
  eventName: string,
  eventTimeIso: string,
) {
  const nextReasons = { ...accumulator.scoredReasons };
  let nextScore = accumulator.score;
  let changed = false;

  signals.forEach((signal) => {
    if (Object.prototype.hasOwnProperty.call(nextReasons, signal.reason)) return;

    nextReasons[signal.reason] = {
      score: signal.score,
      first_seen: eventTimeIso,
      event_name: eventName,
    };
    nextScore += signal.score;
    changed = true;
  });

  const nextStage = getIntentStage(nextScore);
  const nextHighestScore = Math.max(accumulator.highestScore, nextScore);
  const nextHighestStage = getHighestIntentStage(accumulator.highestStage, getIntentStage(nextHighestScore));

  return {
    changed,
    accumulator: {
      score: nextScore,
      stage: nextStage,
      highestScore: nextHighestScore,
      highestStage: nextHighestStage,
      scoredReasons: nextReasons,
      summary: buildIntentSummary(nextScore, nextStage, nextReasons),
    },
  };
}

async function upsertSessionIntentRow(client: PoolClient, params: {
  analyticsSessionId: string;
  anonymousId: string | null;
  eventName: string;
  pagePath: string | null;
  isInternalTest: boolean;
  isLikelyBot: boolean;
}) {
  const result = await client.query(
    `
      INSERT INTO public_analytics_session_intent (
        analytics_session_id,
        anonymous_id,
        first_seen,
        last_seen,
        event_count,
        page_views,
        last_event_name,
        last_page_path,
        is_internal_test,
        is_likely_bot
      )
      VALUES ($1, $2, NOW(), NOW(), 1, CASE WHEN $3 = 'page_view' THEN 1 ELSE 0 END, $3, $4, $5, $6)
      ON CONFLICT (analytics_session_id) DO UPDATE SET
        anonymous_id = COALESCE(public_analytics_session_intent.anonymous_id, EXCLUDED.anonymous_id),
        last_seen = NOW(),
        event_count = public_analytics_session_intent.event_count + 1,
        page_views = public_analytics_session_intent.page_views + CASE WHEN EXCLUDED.last_event_name = 'page_view' THEN 1 ELSE 0 END,
        last_event_name = EXCLUDED.last_event_name,
        last_page_path = COALESCE(EXCLUDED.last_page_path, public_analytics_session_intent.last_page_path),
        is_internal_test = public_analytics_session_intent.is_internal_test OR EXCLUDED.is_internal_test,
        is_likely_bot = public_analytics_session_intent.is_likely_bot OR EXCLUDED.is_likely_bot,
        updated_at = NOW()
      RETURNING *
    `,
    [
      params.analyticsSessionId,
      params.anonymousId,
      params.eventName,
      params.pagePath,
      params.isInternalTest,
      params.isLikelyBot,
    ],
  );

  return result.rows[0];
}

async function upsertVisitorIntentRow(client: PoolClient, params: {
  anonymousId: string;
  eventName: string;
  pagePath: string | null;
  isLikelyBot: boolean;
}) {
  const result = await client.query(
    `
      INSERT INTO public_analytics_visitor_intent (
        anonymous_id,
        first_seen,
        last_seen,
        session_count,
        event_count,
        page_views,
        last_event_name,
        last_page_path,
        is_likely_bot
      )
      VALUES ($1, NOW(), NOW(), 1, 1, CASE WHEN $2 = 'page_view' THEN 1 ELSE 0 END, $2, $3, $4)
      ON CONFLICT (anonymous_id) DO UPDATE SET
        last_seen = NOW(),
        event_count = public_analytics_visitor_intent.event_count + 1,
        page_views = public_analytics_visitor_intent.page_views + CASE WHEN EXCLUDED.last_event_name = 'page_view' THEN 1 ELSE 0 END,
        last_event_name = EXCLUDED.last_event_name,
        last_page_path = COALESCE(EXCLUDED.last_page_path, public_analytics_visitor_intent.last_page_path),
        is_likely_bot = public_analytics_visitor_intent.is_likely_bot OR EXCLUDED.is_likely_bot,
        updated_at = NOW()
      RETURNING *
    `,
    [
      params.anonymousId,
      params.eventName,
      params.pagePath,
      params.isLikelyBot,
    ],
  );

  return result.rows[0];
}

async function saveSessionIntentAccumulator(
  client: PoolClient,
  analyticsSessionId: string,
  accumulator: IntentAccumulatorRow,
  changed: boolean,
) {
  await client.query(
    `
      UPDATE public_analytics_session_intent
      SET
        session_intent_score = $2,
        intent_stage = $3,
        highest_intent_score = $4,
        highest_intent_stage = $5,
        scored_reasons = $6::jsonb,
        intent_summary = $7::jsonb,
        last_intent_update = CASE WHEN $8 THEN NOW() ELSE last_intent_update END,
        updated_at = NOW()
      WHERE analytics_session_id = $1
    `,
    [
      analyticsSessionId,
      accumulator.score,
      accumulator.stage,
      accumulator.highestScore,
      accumulator.highestStage,
      JSON.stringify(accumulator.scoredReasons),
      JSON.stringify(accumulator.summary),
      changed,
    ],
  );
}

async function saveVisitorIntentAccumulator(
  client: PoolClient,
  anonymousId: string,
  accumulator: IntentAccumulatorRow,
  changed: boolean,
) {
  await client.query(
    `
      UPDATE public_analytics_visitor_intent
      SET
        visitor_intent_score = $2,
        intent_stage = $3,
        highest_intent_score = $4,
        highest_intent_stage = $5,
        scored_reasons = $6::jsonb,
        intent_summary = $7::jsonb,
        last_intent_update = CASE WHEN $8 THEN NOW() ELSE last_intent_update END,
        updated_at = NOW()
      WHERE anonymous_id = $1
    `,
    [
      anonymousId,
      accumulator.score,
      accumulator.stage,
      accumulator.highestScore,
      accumulator.highestStage,
      JSON.stringify(accumulator.scoredReasons),
      JSON.stringify(accumulator.summary),
      changed,
    ],
  );
}

async function updateEventIntentSnapshot(client: PoolClient, eventId: number, snapshot: IntentSnapshot) {
  const primary = snapshot.visitor || snapshot.session;
  await client.query(
    `
      UPDATE public_analytics_events
      SET
        session_intent_score = $2,
        visitor_intent_score = $3,
        intent_stage = $4,
        highest_intent_stage = $5,
        highest_intent_score = $6,
        last_intent_update = NOW(),
        intent_summary = $7::jsonb
      WHERE id = $1
    `,
    [
      eventId,
      snapshot.session?.score ?? null,
      snapshot.visitor?.score ?? null,
      primary?.stage ?? null,
      primary?.highestStage ?? null,
      primary?.highestScore ?? null,
      primary?.summary ? JSON.stringify(primary.summary) : null,
    ],
  );
}

async function applyRecoveryIntentScoring(
  client: PoolClient,
  params: {
    eventId: number;
    eventName: string;
    payload: Record<string, unknown>;
    analyticsSessionId: string | null;
    anonymousId: string | null;
    pagePath: string | null;
    routeGroup: string | null;
    isInternalTest: boolean;
    isLikelyBot: boolean;
    eventTimeIso?: string;
  },
) {
  if (params.isInternalTest) {
    return;
  }

  if (!params.analyticsSessionId && !params.anonymousId) {
    return;
  }

  if (params.isLikelyBot) {
    const botAccumulator = {
      score: 0,
      stage: 'COLD',
      highestScore: 0,
      highestStage: 'COLD',
      scoredReasons: {},
      summary: buildIntentSummary(0, 'COLD', {}),
    };

    if (params.analyticsSessionId) {
      await upsertSessionIntentRow(client, {
        analyticsSessionId: params.analyticsSessionId,
        anonymousId: params.anonymousId,
        eventName: params.eventName,
        pagePath: params.pagePath,
        isInternalTest: false,
        isLikelyBot: true,
      });
    }

    await updateEventIntentSnapshot(client, params.eventId, {
      session: params.analyticsSessionId ? botAccumulator : undefined,
      visitor: params.anonymousId ? botAccumulator : undefined,
    });
    return;
  }

  const signals = getRecoveryIntentSignals({
    eventName: params.eventName,
    payload: params.payload,
    pagePath: params.pagePath,
    routeGroup: params.routeGroup,
  });
  const eventTimeIso = params.eventTimeIso || new Date().toISOString();
  const snapshot: IntentSnapshot = {};

  if (params.analyticsSessionId) {
    const sessionRow = await upsertSessionIntentRow(client, {
      analyticsSessionId: params.analyticsSessionId,
      anonymousId: params.anonymousId,
      eventName: params.eventName,
      pagePath: params.pagePath,
      isInternalTest: false,
      isLikelyBot: false,
    });
    const current = toIntentAccumulatorRow(sessionRow, 'session_intent_score');
    const { accumulator, changed } = applySignalsToAccumulator(current, signals, params.eventName, eventTimeIso);
    await saveSessionIntentAccumulator(client, params.analyticsSessionId, accumulator, changed);
    snapshot.session = accumulator;
  }

  if (params.anonymousId) {
    const visitorRow = await upsertVisitorIntentRow(client, {
      anonymousId: params.anonymousId,
      eventName: params.eventName,
      pagePath: params.pagePath,
      isLikelyBot: false,
    });
    const current = toIntentAccumulatorRow(visitorRow, 'visitor_intent_score');
    const { accumulator, changed } = applySignalsToAccumulator(current, signals, params.eventName, eventTimeIso);
    await saveVisitorIntentAccumulator(client, params.anonymousId, accumulator, changed);
    snapshot.visitor = accumulator;
  }

  await updateEventIntentSnapshot(client, params.eventId, snapshot);
}

async function applyExpiredBounceIntentAdjustments(analyticsPool: Pool, days: number) {
  const candidateResult = await analyticsPool.query(
    `
      SELECT
        si.analytics_session_id,
        si.anonymous_id,
        si.session_intent_score,
        si.intent_stage,
        si.highest_intent_score,
        si.highest_intent_stage,
        si.scored_reasons,
        EXTRACT(EPOCH FROM (MAX(e.created_at) - MIN(e.created_at)))::int AS span_seconds,
        COUNT(DISTINCT COALESCE(e.page_path, ''))::int AS distinct_pages,
        COUNT(*) FILTER (
          WHERE e.event_name IN (
            'cta_clicked',
            'early_access_cta_clicked',
            'claim_access_clicked',
            'demo_video_started',
            'demo_video_completed',
            'early_access_viewed',
            'checkout_started',
            'checkout_opened',
            'outbound_payment_clicked',
            'amazon_connect_initiated',
            'oauth_callback_success',
            'payment_success'
          )
        )::int AS high_intent_events
      FROM public_analytics_session_intent si
      JOIN public_analytics_events e
        ON e.analytics_session_id = si.analytics_session_id
      WHERE si.last_seen < NOW() - interval '5 minutes'
        AND si.last_seen >= NOW() - ($1::int * interval '1 day')
        AND NOT COALESCE(si.is_internal_test, false)
        AND NOT COALESCE(si.is_likely_bot, false)
        AND NOT (COALESCE(si.scored_reasons, '{}'::jsonb) ? 'bounce_under_5_seconds')
      GROUP BY
        si.analytics_session_id,
        si.anonymous_id,
        si.session_intent_score,
        si.intent_stage,
        si.highest_intent_score,
        si.highest_intent_stage,
        si.scored_reasons
      HAVING EXTRACT(EPOCH FROM (MAX(e.created_at) - MIN(e.created_at))) <= 5
        AND COUNT(DISTINCT COALESCE(e.page_path, '')) <= 1
        AND COUNT(*) FILTER (
          WHERE e.event_name IN (
            'cta_clicked',
            'early_access_cta_clicked',
            'claim_access_clicked',
            'demo_video_started',
            'demo_video_completed',
            'early_access_viewed',
            'checkout_started',
            'checkout_opened',
            'outbound_payment_clicked',
            'amazon_connect_initiated',
            'oauth_callback_success',
            'payment_success'
          )
        ) = 0
      LIMIT 200
    `,
    [Math.max(1, Math.min(90, days))],
  );

  for (const candidate of candidateResult.rows) {
    const client = await analyticsPool.connect();
    try {
      await client.query('BEGIN');
      const sessionLock = await client.query(
        `
          SELECT *
          FROM public_analytics_session_intent
          WHERE analytics_session_id = $1
          FOR UPDATE
        `,
        [candidate.analytics_session_id],
      );
      const sessionRow = sessionLock.rows[0];
      if (!sessionRow || normalizeScoredReasons(sessionRow.scored_reasons).bounce_under_5_seconds) {
        await client.query('COMMIT');
        continue;
      }

      const eventTimeIso = new Date().toISOString();
      const bounceSignal = [{ reason: 'bounce_under_5_seconds', score: -5 }];
      const sessionAccumulator = toIntentAccumulatorRow(sessionRow, 'session_intent_score');
      const sessionUpdate = applySignalsToAccumulator(sessionAccumulator, bounceSignal, 'bounce_under_5_seconds', eventTimeIso);
      await saveSessionIntentAccumulator(client, candidate.analytics_session_id, sessionUpdate.accumulator, sessionUpdate.changed);

      if (candidate.anonymous_id) {
        const visitorLock = await client.query(
          `
            SELECT *
            FROM public_analytics_visitor_intent
            WHERE anonymous_id = $1
            FOR UPDATE
          `,
          [candidate.anonymous_id],
        );
        const visitorRow = visitorLock.rows[0];
        if (visitorRow && !normalizeScoredReasons(visitorRow.scored_reasons).bounce_under_5_seconds) {
          const visitorAccumulator = toIntentAccumulatorRow(visitorRow, 'visitor_intent_score');
          const visitorUpdate = applySignalsToAccumulator(visitorAccumulator, bounceSignal, 'bounce_under_5_seconds', eventTimeIso);
          await saveVisitorIntentAccumulator(client, candidate.anonymous_id, visitorUpdate.accumulator, visitorUpdate.changed);
        }
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      logger.warn('[PUBLIC ANALYTICS] Failed to apply bounce intent adjustment', {
        sessionId: candidate.analytics_session_id,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      client.release();
    }
  }
}

async function backfillRecentIntentScores(analyticsPool: Pool, days: number) {
  const windowDays = Math.max(1, Math.min(90, days));
  const eventResult = await analyticsPool.query(
    `
      SELECT
        id,
        event_name,
        payload,
        analytics_session_id,
        anonymous_id,
        page_path,
        route_group,
        created_at,
        ${INTERNAL_TEST_SQL} AS is_internal_test,
        ${LIKELY_BOT_SQL} AS is_likely_bot
      FROM public_analytics_events
      WHERE created_at >= NOW() - ($1::int * interval '1 day')
        AND intent_stage IS NULL
        AND (analytics_session_id IS NOT NULL OR anonymous_id IS NOT NULL)
        AND NOT ${INTERNAL_TEST_SQL}
      ORDER BY created_at ASC
      LIMIT 250
    `,
    [windowDays],
  );

  if (eventResult.rows.length === 0) return;

  const client = await analyticsPool.connect();
  try {
    for (const event of eventResult.rows) {
      try {
        await client.query('BEGIN');
        await applyRecoveryIntentScoring(client, {
          eventId: Number(event.id),
          eventName: event.event_name,
          payload: event.payload || {},
          analyticsSessionId: event.analytics_session_id || null,
          anonymousId: event.anonymous_id || null,
          pagePath: event.page_path || null,
          routeGroup: event.route_group || null,
          isInternalTest: Boolean(event.is_internal_test),
          isLikelyBot: Boolean(event.is_likely_bot),
          eventTimeIso: event.created_at instanceof Date
            ? event.created_at.toISOString()
            : new Date(event.created_at).toISOString(),
        });
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        logger.warn('[PUBLIC ANALYTICS] Failed to backfill recovery intent score', {
          eventId: event.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } finally {
    client.release();
  }
}

function scheduleIntentMaintenance(analyticsPool: Pool, days: number, context: 'summary' | 'timeline') {
  if (intentMaintenanceRunning) return;

  intentMaintenanceRunning = true;
  const timer = setTimeout(async () => {
    try {
      await backfillRecentIntentScores(analyticsPool, days);
      await applyExpiredBounceIntentAdjustments(analyticsPool, days);
    } catch (error) {
      logger.warn('[PUBLIC ANALYTICS] Background intent maintenance skipped', {
        context,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      intentMaintenanceRunning = false;
    }
  }, 250);

  if (typeof timer.unref === 'function') {
    timer.unref();
  }
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
    const clientIp = getClientIp(req);
    const derived = buildDerivedAnalyticsFields(sanitizedPayload, req, clientIp);
    const analyticsSessionId = getStringPayloadValue(sanitizedPayload, 'analytics_session_id');
    const anonymousId = getStringPayloadValue(sanitizedPayload, 'anonymous_id');
    const pagePath = getStringPayloadValue(sanitizedPayload, 'page_path');
    const client = await analyticsPool.connect();

    try {
      await client.query('BEGIN');
      const insertResult = await client.query(
        `
          INSERT INTO public_analytics_events (
            event_name,
            event_id,
            event_day,
            anonymous_id,
            analytics_session_id,
            user_id,
            user_email_domain,
            active_tenant_slug,
            page_path,
            page_location,
            traffic_source_hint,
            source_type,
            device_shape,
            route_group,
            referrer_host,
            utm_source,
            utm_medium,
            utm_campaign,
            geo_country,
            payload,
            ip_hash,
            ip_address,
            user_agent,
            is_internal_test,
            is_demo_session,
            is_likely_bot
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
            $11, $12, $13, $14, $15, $16, $17, $18, $19,
            $20::jsonb, $21, $22, $23, $24, $25, $26
          )
          RETURNING id
        `,
        [
          eventName,
          getStringPayloadValue(sanitizedPayload, 'event_id'),
          derived.eventDay,
          anonymousId,
          analyticsSessionId,
          getStringPayloadValue(sanitizedPayload, 'user_id'),
          getStringPayloadValue(sanitizedPayload, 'user_email_domain'),
          getStringPayloadValue(sanitizedPayload, 'active_tenant_slug'),
          pagePath,
          getStringPayloadValue(sanitizedPayload, 'page_location'),
          getStringPayloadValue(sanitizedPayload, 'traffic_source_hint'),
          derived.sourceType,
          derived.deviceShape,
          derived.routeGroup,
          derived.referrerHost,
          derived.utmSource,
          derived.utmMedium,
          derived.utmCampaign,
          derived.geoCountry,
          JSON.stringify(sanitizedPayload),
          derived.ipHash,
          clientIp,
          derived.userAgent,
          derived.isInternalTest,
          derived.isDemoSession,
          derived.isLikelyBot,
        ],
      );

      const eventId = Number(insertResult.rows[0]?.id);
      if (Number.isFinite(eventId)) {
        await applyRecoveryIntentScoring(client, {
          eventId,
          eventName,
          payload: sanitizedPayload,
          analyticsSessionId,
          anonymousId,
          pagePath,
          routeGroup: derived.routeGroup,
          isInternalTest: derived.isInternalTest,
          isLikelyBot: derived.isLikelyBot,
        });
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    logger.warn('[PUBLIC ANALYTICS] Failed to persist event; continuing without blocking request', {
      eventName,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function normalizeSummaryWindow(days?: unknown) {
  const parsedDays = Number(days);
  if (!Number.isFinite(parsedDays)) return 7;
  return Math.min(90, Math.max(1, Math.floor(parsedDays)));
}

export async function getPublicAnalyticsSummary(days?: unknown) {
  const windowDays = normalizeSummaryWindow(days);
  const analyticsPool = getAnalyticsPool();
  if (!analyticsPool) {
    return {
      available: false,
      days: windowDays,
      reason: 'DATABASE_URL_NOT_CONFIGURED',
    };
  }

  await ensurePublicAnalyticsSchema();
  scheduleIntentMaintenance(analyticsPool, windowDays, 'summary');

  const baseWhere = `
    created_at >= now() - ($1::int * interval '1 day')
  `;
  const nonInternalWhere = `
    ${baseWhere}
    AND NOT ${INTERNAL_TEST_SQL}
  `;
  const likelyHumanWhere = `
    ${nonInternalWhere}
    AND NOT ${LIKELY_BOT_SQL}
  `;

  const [
    overview,
    today,
    daily,
    topPages,
    topEvents,
    funnel,
    conversionFunnel,
    sources,
    devices,
    routeGroups,
    visitorsByIntentStage,
    averageIntent,
    highestIntentVisitors,
    topIntentReasons,
  ] = await Promise.all([
    analyticsPool.query(`
      SELECT
        COUNT(*)::int AS total_events,
        COUNT(*) FILTER (WHERE event_name = 'page_view')::int AS page_views,
        COUNT(DISTINCT analytics_session_id) FILTER (WHERE analytics_session_id IS NOT NULL)::int AS sessions,
        COUNT(DISTINCT anonymous_id) FILTER (WHERE anonymous_id IS NOT NULL)::int AS anonymous_visitors,
        COUNT(DISTINCT analytics_session_id) FILTER (
          WHERE analytics_session_id IS NOT NULL
            AND NOT ${LIKELY_BOT_SQL}
            AND NOT ${INTERNAL_TEST_SQL}
        )::int AS likely_human_sessions,
        COUNT(DISTINCT anonymous_id) FILTER (
          WHERE anonymous_id IS NOT NULL
            AND NOT ${LIKELY_BOT_SQL}
            AND NOT ${INTERNAL_TEST_SQL}
        )::int AS likely_human_visitors,
        COUNT(DISTINCT analytics_session_id) FILTER (
          WHERE analytics_session_id IS NOT NULL
            AND ${LIKELY_BOT_SQL}
            AND NOT ${INTERNAL_TEST_SQL}
        )::int AS bot_or_preview_sessions,
        COUNT(DISTINCT analytics_session_id) FILTER (
          WHERE analytics_session_id IS NOT NULL
            AND ${INTERNAL_TEST_SQL}
        )::int AS internal_test_sessions,
        MIN(created_at) AS first_seen,
        MAX(created_at) AS last_seen
      FROM public_analytics_events
      WHERE ${baseWhere}
    `, [windowDays]),
    analyticsPool.query(`
      SELECT
        COUNT(DISTINCT analytics_session_id) FILTER (
          WHERE analytics_session_id IS NOT NULL
            AND NOT ${LIKELY_BOT_SQL}
            AND NOT ${INTERNAL_TEST_SQL}
        )::int AS human_sessions,
        COUNT(DISTINCT anonymous_id) FILTER (
          WHERE anonymous_id IS NOT NULL
            AND NOT ${LIKELY_BOT_SQL}
            AND NOT ${INTERNAL_TEST_SQL}
        )::int AS human_visitors,
        COUNT(DISTINCT analytics_session_id) FILTER (
          WHERE analytics_session_id IS NOT NULL
            AND ${LIKELY_BOT_SQL}
            AND NOT ${INTERNAL_TEST_SQL}
        )::int AS bot_sessions,
        COUNT(DISTINCT anonymous_id) FILTER (
          WHERE anonymous_id IS NOT NULL
            AND ${LIKELY_BOT_SQL}
            AND NOT ${INTERNAL_TEST_SQL}
        )::int AS bot_visitors
      FROM public_analytics_events
      WHERE COALESCE(event_day, (created_at AT TIME ZONE 'UTC')::date) = (NOW() AT TIME ZONE 'UTC')::date
    `),
    analyticsPool.query(`
      SELECT
        COALESCE(event_day, (created_at AT TIME ZONE 'UTC')::date) AS event_day,
        COUNT(*)::int AS total_events,
        COUNT(*) FILTER (WHERE event_name = 'page_view')::int AS page_views,
        COUNT(DISTINCT analytics_session_id) FILTER (WHERE analytics_session_id IS NOT NULL)::int AS sessions,
        COUNT(DISTINCT anonymous_id) FILTER (WHERE anonymous_id IS NOT NULL)::int AS anonymous_visitors,
        COUNT(DISTINCT analytics_session_id) FILTER (
          WHERE analytics_session_id IS NOT NULL AND NOT ${LIKELY_BOT_SQL}
        )::int AS likely_human_sessions,
        COUNT(DISTINCT anonymous_id) FILTER (
          WHERE anonymous_id IS NOT NULL AND NOT ${LIKELY_BOT_SQL}
        )::int AS likely_human_visitors,
        COUNT(DISTINCT analytics_session_id) FILTER (
          WHERE analytics_session_id IS NOT NULL AND ${LIKELY_BOT_SQL}
        )::int AS bot_or_preview_sessions
      FROM public_analytics_events
      WHERE ${nonInternalWhere}
      GROUP BY COALESCE(event_day, (created_at AT TIME ZONE 'UTC')::date)
      ORDER BY event_day DESC
    `, [windowDays]),
    analyticsPool.query(`
      SELECT
        COALESCE(page_path, '(none)') AS page_path,
        COALESCE(route_group, 'unknown') AS route_group,
        COUNT(*)::int AS page_views,
        COUNT(DISTINCT analytics_session_id) FILTER (WHERE analytics_session_id IS NOT NULL)::int AS sessions,
        COUNT(DISTINCT anonymous_id) FILTER (WHERE anonymous_id IS NOT NULL)::int AS visitors,
        MAX(created_at) AS last_seen
      FROM public_analytics_events
      WHERE ${likelyHumanWhere}
        AND event_name = 'page_view'
      GROUP BY page_path, route_group
      ORDER BY page_views DESC
      LIMIT 30
    `, [windowDays]),
    analyticsPool.query(`
      SELECT
        event_name,
        COUNT(*)::int AS events,
        COUNT(DISTINCT analytics_session_id) FILTER (WHERE analytics_session_id IS NOT NULL)::int AS sessions,
        MAX(created_at) AS last_seen
      FROM public_analytics_events
      WHERE ${likelyHumanWhere}
      GROUP BY event_name
      ORDER BY events DESC
      LIMIT 30
    `, [windowDays]),
    analyticsPool.query(`
      SELECT
        event_name,
        COUNT(*)::int AS events,
        COUNT(DISTINCT analytics_session_id) FILTER (WHERE analytics_session_id IS NOT NULL)::int AS sessions,
        COUNT(DISTINCT anonymous_id) FILTER (WHERE anonymous_id IS NOT NULL)::int AS visitors,
        MAX(created_at) AS last_seen
      FROM public_analytics_events
      WHERE ${likelyHumanWhere}
        AND event_name = ANY($2::text[])
      GROUP BY event_name
      ORDER BY array_position($2::text[], event_name)
    `, [windowDays, FUNNEL_EVENT_NAMES]),
    analyticsPool.query(`
      WITH likely_human_events AS (
        SELECT *
        FROM public_analytics_events
        WHERE ${likelyHumanWhere}
      ),
      funnel_steps AS (
        SELECT
          1 AS step_order,
          'Homepage' AS step,
          COUNT(*)::int AS events,
          COUNT(DISTINCT analytics_session_id) FILTER (WHERE analytics_session_id IS NOT NULL)::int AS sessions,
          COUNT(DISTINCT anonymous_id) FILTER (WHERE anonymous_id IS NOT NULL)::int AS visitors
        FROM likely_human_events
        WHERE event_name = 'homepage_viewed'
          OR (event_name = 'page_view' AND (route_group = 'home' OR page_path = '/'))
        UNION ALL
        SELECT
          2 AS step_order,
          'Demo' AS step,
          COUNT(*)::int AS events,
          COUNT(DISTINCT analytics_session_id) FILTER (WHERE analytics_session_id IS NOT NULL)::int AS sessions,
          COUNT(DISTINCT anonymous_id) FILTER (WHERE anonymous_id IS NOT NULL)::int AS visitors
        FROM likely_human_events
        WHERE event_name IN ('demo_video_started', 'demo_video_completed', 'demo_cta_clicked')
        UNION ALL
        SELECT
          3 AS step_order,
          'Early Access' AS step,
          COUNT(*)::int AS events,
          COUNT(DISTINCT analytics_session_id) FILTER (WHERE analytics_session_id IS NOT NULL)::int AS sessions,
          COUNT(DISTINCT anonymous_id) FILTER (WHERE anonymous_id IS NOT NULL)::int AS visitors
        FROM likely_human_events
        WHERE event_name = 'early_access_viewed'
          OR (event_name = 'page_view' AND route_group = 'early_access')
        UNION ALL
        SELECT
          4 AS step_order,
          'Checkout' AS step,
          COUNT(*)::int AS events,
          COUNT(DISTINCT analytics_session_id) FILTER (WHERE analytics_session_id IS NOT NULL)::int AS sessions,
          COUNT(DISTINCT anonymous_id) FILTER (WHERE anonymous_id IS NOT NULL)::int AS visitors
        FROM likely_human_events
        WHERE event_name IN ('checkout_started', 'checkout_opened', 'outbound_payment_clicked', 'payment_button_clicked')
        UNION ALL
        SELECT
          5 AS step_order,
          'OAuth' AS step,
          COUNT(*)::int AS events,
          COUNT(DISTINCT analytics_session_id) FILTER (WHERE analytics_session_id IS NOT NULL)::int AS sessions,
          COUNT(DISTINCT anonymous_id) FILTER (WHERE anonymous_id IS NOT NULL)::int AS visitors
        FROM likely_human_events
        WHERE event_name IN ('amazon_connect_initiated', 'oauth_started', 'oauth_connect_started', 'provider_connect_started', 'oauth_callback_success', 'oauth_completed', 'provider_connect_completed')
        UNION ALL
        SELECT
          6 AS step_order,
          'Payment' AS step,
          COUNT(*)::int AS events,
          COUNT(DISTINCT analytics_session_id) FILTER (WHERE analytics_session_id IS NOT NULL)::int AS sessions,
          COUNT(DISTINCT anonymous_id) FILTER (WHERE anonymous_id IS NOT NULL)::int AS visitors
        FROM likely_human_events
        WHERE event_name = 'payment_success'
      )
      SELECT step_order, step, events, sessions, visitors
      FROM funnel_steps
      ORDER BY step_order
    `, [windowDays]),
    analyticsPool.query(`
      SELECT
        COALESCE(source_type, 'unknown') AS source_type,
        COALESCE(traffic_source_hint, '(direct/unknown)') AS traffic_source_hint,
        COALESCE(referrer_host, '(none)') AS referrer_host,
        COUNT(*)::int AS events,
        COUNT(DISTINCT analytics_session_id) FILTER (WHERE analytics_session_id IS NOT NULL)::int AS sessions,
        COUNT(DISTINCT anonymous_id) FILTER (WHERE anonymous_id IS NOT NULL)::int AS visitors,
        MAX(created_at) AS last_seen
      FROM public_analytics_events
      WHERE ${likelyHumanWhere}
        AND event_name IN ('page_view', 'public_page_viewed', 'homepage_viewed', 'app_gate_viewed', 'claim_access_clicked', 'checkout_started')
      GROUP BY source_type, traffic_source_hint, referrer_host
      ORDER BY sessions DESC, events DESC
      LIMIT 20
    `, [windowDays]),
    analyticsPool.query(`
      SELECT
        COALESCE(
          device_shape,
          CASE
            WHEN ${LIKELY_BOT_SQL} THEN 'bot_or_preview'
            WHEN COALESCE(user_agent, '') ~* 'mobile|iphone|android|ipad|tablet' THEN 'mobile'
            WHEN user_agent IS NULL THEN 'unknown'
            ELSE 'desktop_or_tablet'
          END
        ) AS device_shape,
        COUNT(*) FILTER (WHERE event_name = 'page_view')::int AS page_views,
        COUNT(DISTINCT analytics_session_id) FILTER (WHERE analytics_session_id IS NOT NULL)::int AS sessions,
        COUNT(DISTINCT anonymous_id) FILTER (WHERE anonymous_id IS NOT NULL)::int AS visitors
      FROM public_analytics_events
      WHERE ${nonInternalWhere}
      GROUP BY 1
      ORDER BY page_views DESC
    `, [windowDays]),
    analyticsPool.query(`
      SELECT
        COALESCE(route_group, 'unknown') AS route_group,
        COUNT(*) FILTER (WHERE event_name = 'page_view')::int AS page_views,
        COUNT(DISTINCT analytics_session_id) FILTER (WHERE analytics_session_id IS NOT NULL)::int AS sessions,
        COUNT(DISTINCT anonymous_id) FILTER (WHERE anonymous_id IS NOT NULL)::int AS visitors
      FROM public_analytics_events
      WHERE ${likelyHumanWhere}
      GROUP BY route_group
      ORDER BY page_views DESC
    `, [windowDays]),
    analyticsPool.query(`
      WITH stages(intent_stage, sort_order) AS (
        VALUES
          ('COLD', 1),
          ('INTERESTED', 2),
          ('ENGAGED', 3),
          ('HIGH_INTENT', 4),
          ('RECOVERY_READY', 5),
          ('CUSTOMER', 6)
      ),
      stage_counts AS (
        SELECT
          intent_stage,
          COUNT(*)::int AS visitors,
          ROUND(AVG(visitor_intent_score)::numeric, 2) AS average_score,
          MAX(visitor_intent_score)::int AS highest_score
        FROM public_analytics_visitor_intent
        WHERE last_seen >= NOW() - ($1::int * interval '1 day')
          AND NOT COALESCE(is_likely_bot, false)
        GROUP BY intent_stage
      )
      SELECT
        stages.intent_stage,
        COALESCE(stage_counts.visitors, 0)::int AS visitors,
        COALESCE(stage_counts.average_score, 0)::float AS average_score,
        COALESCE(stage_counts.highest_score, 0)::int AS highest_score
      FROM stages
      LEFT JOIN stage_counts
        ON stage_counts.intent_stage = stages.intent_stage
      ORDER BY stages.sort_order
    `, [windowDays]),
    analyticsPool.query(`
      SELECT
        COALESCE(ROUND(AVG(visitor_intent_score)::numeric, 2), 0)::float AS average_visitor_intent_score,
        COALESCE(MAX(visitor_intent_score), 0)::int AS highest_visitor_intent_score,
        COUNT(*)::int AS scored_visitors
      FROM public_analytics_visitor_intent
      WHERE last_seen >= NOW() - ($1::int * interval '1 day')
        AND NOT COALESCE(is_likely_bot, false)
    `, [windowDays]),
    analyticsPool.query(`
      SELECT
        anonymous_id,
        visitor_intent_score,
        intent_stage,
        highest_intent_score,
        highest_intent_stage,
        intent_summary,
        event_count,
        page_views,
        first_seen,
        last_seen,
        last_event_name,
        last_page_path
      FROM public_analytics_visitor_intent
      WHERE last_seen >= NOW() - ($1::int * interval '1 day')
        AND NOT COALESCE(is_likely_bot, false)
      ORDER BY visitor_intent_score DESC, highest_intent_score DESC, last_seen DESC
      LIMIT 20
    `, [windowDays]),
    analyticsPool.query(`
      SELECT
        reasons.reason,
        COUNT(*)::int AS visitors,
        SUM(COALESCE((reasons.details->>'score')::int, 0))::int AS score_contribution,
        MAX(vi.last_seen) AS last_seen
      FROM public_analytics_visitor_intent vi
      CROSS JOIN LATERAL jsonb_each(COALESCE(vi.scored_reasons, '{}'::jsonb)) AS reasons(reason, details)
      WHERE vi.last_seen >= NOW() - ($1::int * interval '1 day')
        AND NOT COALESCE(vi.is_likely_bot, false)
      GROUP BY reasons.reason
      ORDER BY visitors DESC, score_contribution DESC
      LIMIT 20
    `, [windowDays]),
  ]);

  return {
    available: true,
    days: windowDays,
    generatedAt: new Date().toISOString(),
    overview: overview.rows[0] || null,
    today: today.rows[0] || null,
    daily: daily.rows,
    topPages: topPages.rows,
    topEvents: topEvents.rows,
    funnel: funnel.rows,
    conversionFunnel: conversionFunnel.rows,
    sources: sources.rows,
    devices: devices.rows,
    routeGroups: routeGroups.rows,
    visitorsByIntentStage: visitorsByIntentStage.rows,
    averageIntentScore: averageIntent.rows[0] || null,
    highestIntentVisitors: highestIntentVisitors.rows,
    topIntentReasons: topIntentReasons.rows,
  };
}

function normalizeTimelineVisitorId(value: unknown) {
  const visitorId = typeof value === 'string' ? value.trim() : '';
  if (!/^[a-zA-Z0-9._:-]{8,200}$/.test(visitorId)) return null;
  return visitorId;
}

function getTimelineLabel(eventName: string, payload: Record<string, unknown>, pagePath: string | null, routeGroup: string | null) {
  if (eventName === 'homepage_viewed' || (eventName === 'page_view' && (routeGroup === 'home' || pagePath === '/'))) {
    return 'Homepage';
  }

  if (eventName === 'scroll_depth_reached') {
    const percent = payload.scroll_percent || payload.scrollPercent || payload.percent || payload.depth;
    return percent ? `Scroll ${percent}%` : 'Scroll depth reached';
  }

  if (eventName === 'demo_video_started') return 'Demo Started';
  if (eventName === 'demo_video_completed') return 'Demo Completed';
  if (eventName === 'early_access_viewed' || (eventName === 'page_view' && routeGroup === 'early_access')) return 'Early Access';
  if (['cta_clicked', 'early_access_cta_clicked', 'claim_access_clicked', 'app_gate_early_access_clicked', 'payment_button_clicked'].includes(eventName)) return 'CTA Clicked';
  if (['checkout_started', 'checkout_opened', 'outbound_payment_clicked'].includes(eventName)) return 'Checkout';
  if (['amazon_connect_initiated', 'oauth_started', 'oauth_connect_started', 'provider_connect_started'].includes(eventName)) return 'OAuth Started';
  if (['oauth_callback_success', 'oauth_completed', 'provider_connect_completed'].includes(eventName)) return 'OAuth Completed';
  if (eventName === 'payment_success') return 'Payment Success';
  if (eventName === 'page_view') return pagePath || 'Page View';

  return eventName
    .split('_')
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(' ');
}

export async function getPublicAnalyticsVisitorTimeline(visitorIdInput: unknown, days?: unknown) {
  const visitorId = normalizeTimelineVisitorId(visitorIdInput);
  const windowDays = normalizeSummaryWindow(days);
  const analyticsPool = getAnalyticsPool();

  if (!visitorId) {
    return {
      available: false,
      days: windowDays,
      error: 'INVALID_VISITOR_ID',
    };
  }

  if (!analyticsPool) {
    return {
      available: false,
      days: windowDays,
      reason: 'DATABASE_URL_NOT_CONFIGURED',
    };
  }

  await ensurePublicAnalyticsSchema();
  scheduleIntentMaintenance(analyticsPool, windowDays, 'timeline');

  const [visitor, events] = await Promise.all([
    analyticsPool.query(
      `
        SELECT
          anonymous_id,
          visitor_intent_score,
          intent_stage,
          highest_intent_score,
          highest_intent_stage,
          intent_summary,
          event_count,
          page_views,
          first_seen,
          last_seen,
          last_event_name,
          last_page_path,
          is_likely_bot
        FROM public_analytics_visitor_intent
        WHERE anonymous_id = $1
      `,
      [visitorId],
    ),
    analyticsPool.query(
      `
        SELECT
          id,
          created_at,
          event_name,
          page_path,
          route_group,
          payload,
          session_intent_score,
          visitor_intent_score,
          intent_stage,
          highest_intent_stage,
          highest_intent_score,
          intent_summary
        FROM public_analytics_events
        WHERE anonymous_id = $1
          AND created_at >= NOW() - ($2::int * interval '1 day')
          AND NOT ${INTERNAL_TEST_SQL}
        ORDER BY created_at ASC
        LIMIT 300
      `,
      [visitorId, windowDays],
    ),
  ]);

  return {
    available: true,
    days: windowDays,
    generatedAt: new Date().toISOString(),
    visitor: visitor.rows[0] || null,
    timeline: events.rows.map((event) => {
      const payload = event.payload && typeof event.payload === 'object'
        ? event.payload as Record<string, unknown>
        : {};
      return {
        id: event.id,
        at: event.created_at,
        event_name: event.event_name,
        label: getTimelineLabel(event.event_name, payload, event.page_path, event.route_group),
        page_path: event.page_path,
        route_group: event.route_group,
        intent_stage: event.intent_stage,
        session_intent_score: event.session_intent_score,
        visitor_intent_score: event.visitor_intent_score,
        highest_intent_stage: event.highest_intent_stage,
        highest_intent_score: event.highest_intent_score,
        intent_summary: event.intent_summary,
        reasons: getRecoveryIntentSignals({
          eventName: event.event_name,
          payload,
          pagePath: event.page_path,
          routeGroup: event.route_group,
        }).map((signal) => signal.reason),
      };
    }),
  };
}
