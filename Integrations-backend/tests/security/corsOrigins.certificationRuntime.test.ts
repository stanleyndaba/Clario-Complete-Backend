import { afterEach, describe, expect, it } from '@jest/globals';
import { buildConfiguredCorsOrigins } from '../../src/security/corsOrigins';

const ORIGINAL_ENV = process.env;

afterEach(() => {
  process.env = ORIGINAL_ENV;
});

describe('certification runtime CORS origins', () => {
  it('retains stable production origins outside certification runtime', () => {
    process.env = { NODE_ENV: 'production' };

    const origins = buildConfiguredCorsOrigins();

    expect(origins.has('https://margin-finance.com')).toBe(true);
    expect(origins.has('https://www.margin-finance.com')).toBe(true);
  });

  it('excludes all production Margin origins from certification runtime', () => {
    process.env = {
      NODE_ENV: 'production',
      CERTIFICATION_RUNTIME: 'true',
      FRONTEND_URL: 'https://isolated-control.example.test/',
    };

    const origins = buildConfiguredCorsOrigins();

    expect(origins).toEqual(new Set(['https://isolated-control.example.test']));
    expect(origins.has('https://margin-finance.com')).toBe(false);
    expect(origins.has('https://www.margin-finance.com')).toBe(false);
  });
});
