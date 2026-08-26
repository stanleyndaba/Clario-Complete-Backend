import type { CorsOptions } from 'cors';

export const SYNTHETIC_EXECUTION_PROVENANCE_HEADER = 'X-Margin-Execution-Provenance';

export interface CorsEnvironment {
  NODE_ENV?: string;
  FRONTEND_URL?: string;
  PUBLIC_FRONTEND_URL?: string;
  ALLOWED_FRONTEND_ORIGINS?: string;
  CORS_ALLOW_ORIGINS?: string;
}

export function buildConfiguredCorsOrigins(env: CorsEnvironment = process.env as CorsEnvironment): Set<string> {
  return new Set(
    [
      env.FRONTEND_URL,
      env.PUBLIC_FRONTEND_URL,
      ...(env.ALLOWED_FRONTEND_ORIGINS || env.CORS_ALLOW_ORIGINS || '').split(','),
      'https://margin-finance.com',
      'https://www.margin-finance.com',
    ]
      .map((value) => String(value || '').trim().replace(/\/$/, ''))
      .filter(Boolean),
  );
}

/**
 * Browser CORS policy shared by production and route-level certification tests.
 * The custom provenance header is intentionally explicit: the synthetic endpoint
 * must require it, and a browser must be allowed to send it only from an allowed origin.
 */
export function buildCorsOptions(env: CorsEnvironment = process.env as CorsEnvironment): CorsOptions {
  const configuredCorsOrigins = buildConfiguredCorsOrigins(env);
  const isProduction = env.NODE_ENV === 'production';

  return {
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      const normalizedOrigin = origin.replace(/\/$/, '');
      const isLocalDevelopment = !isProduction && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(normalizedOrigin);
      if (isLocalDevelopment || configuredCorsOrigins.has(normalizedOrigin)) {
        return callback(null, true);
      }
      return callback(new Error('CORS: origin is not allowed'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'X-User-Id',
      'X-Forwarded-User-Id',
      'X-Tenant-Id',
      'X-Tenant-Slug',
      'X-Demo-Mode',
      'X-Store-Id',
      'X-Frontend-URL',
      'X-Request-Id',
      'X-Correlation-Id',
      SYNTHETIC_EXECUTION_PROVENANCE_HEADER,
      'Origin',
      'Referer',
      'Accept',
      'Cache-Control',
    ],
    exposedHeaders: ['X-User-Id', 'X-Request-Id', 'X-Tenant-Id', 'X-Tenant-Slug', 'X-Store-Id'],
    maxAge: 86400,
  };
}
