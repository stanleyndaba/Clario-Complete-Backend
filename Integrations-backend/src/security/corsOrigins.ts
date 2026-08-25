const PRODUCTION_MARGIN_ORIGINS = [
  'https://margin-finance.com',
  'https://www.margin-finance.com',
] as const;

export function isCertificationRuntime(environment: NodeJS.ProcessEnv = process.env): boolean {
  return environment.CERTIFICATION_RUNTIME === 'true';
}

/**
 * Browser origins are exact and environment controlled. The isolated
 * certification runtime deliberately excludes the stable production Margin
 * origins, even if its FRONTEND_URL is not configured during Gate 1.
 */
export function buildConfiguredCorsOrigins(
  environment: NodeJS.ProcessEnv = process.env
): Set<string> {
  const configuredOrigins = [
    environment.FRONTEND_URL,
    environment.PUBLIC_FRONTEND_URL,
    ...(environment.ALLOWED_FRONTEND_ORIGINS || environment.CORS_ALLOW_ORIGINS || '').split(','),
    ...(isCertificationRuntime(environment) ? [] : PRODUCTION_MARGIN_ORIGINS),
  ];

  return new Set(
    configuredOrigins
      .map((value) => String(value || '').trim().replace(/\/$/, ''))
      .filter(Boolean)
  );
}
