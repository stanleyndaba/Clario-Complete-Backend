import { afterEach, describe, expect, it } from '@jest/globals';
import { validateEnvironment } from '../../src/security/envValidation';

const ORIGINAL_ENV = process.env;
const STRONG_JWT_SECRET = 'certification-runtime-jwt-secret-at-least-thirty-two-characters';
const ISOLATED_DATABASE_URL = 'postgresql://certification:password@isolated.example/neondb';

function setProductionEnvironment(overrides: Record<string, string | undefined> = {}): void {
  process.env = {
    NODE_ENV: 'production',
    JWT_SECRET: STRONG_JWT_SECRET,
    DATABASE_URL: ISOLATED_DATABASE_URL,
    ...overrides,
  };
}

afterEach(() => {
  process.env = ORIGINAL_ENV;
});

describe('certification runtime environment validation', () => {
  it('continues to require Amazon credentials in normal production mode', () => {
    setProductionEnvironment();

    const result = validateEnvironment(true);

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      'Required environment variable AMAZON_CLIENT_ID is not set',
      'Required environment variable AMAZON_CLIENT_SECRET is not set',
      'Required environment variable AMAZON_SPAPI_REFRESH_TOKEN is not set',
    ]));
  });

  it('fails closed when certification runtime omits its secondary Amazon-omission acknowledgement', () => {
    setProductionEnvironment({ CERTIFICATION_RUNTIME: 'true' });

    const result = validateEnvironment(true);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      'CERTIFICATION_RUNTIME=true requires CERTIFICATION_ALLOW_AMAZON_OMISSION=true'
    );
  });

  it('permits only the Amazon omission in the explicit production certification profile', () => {
    setProductionEnvironment({
      CERTIFICATION_RUNTIME: 'true',
      CERTIFICATION_ALLOW_AMAZON_OMISSION: 'true',
    });

    const result = validateEnvironment(true);

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects the Amazon-omission switch outside certification runtime', () => {
    setProductionEnvironment({ CERTIFICATION_ALLOW_AMAZON_OMISSION: 'true' });

    const result = validateEnvironment(true);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      'CERTIFICATION_ALLOW_AMAZON_OMISSION may be enabled only with CERTIFICATION_RUNTIME=true'
    );
  });
});
