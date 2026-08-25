import { afterEach, describe, expect, it } from '@jest/globals';
import { isCertificationSidecarEnabled, loadCertificationSidecarConfig } from '../../src/certification/certificationSidecarConfig';

const ORIGINAL_ENV = process.env;

function completeSidecarEnvironment(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'production',
    CERTIFICATION_SIDECAR_ENABLED: 'true',
    CERTIFICATION_SIDECAR_ACKNOWLEDGEMENT: 'production-adjacent-dependency-isolation',
    CERTIFICATION_REDIS_URL: 'rediss://default:test@isolated-redis.example.test:6379',
    CERTIFICATION_DATABASE_URL: 'postgresql://test:password@isolated-db.example.test/certification',
    DATABASE_URL: 'postgresql://prod:password@production-db.example.test/production',
    REDIS_URL: 'rediss://default:prod@production-redis.example.test:6379',
    CERTIFICATION_INTERNAL_API_KEY: 'a'.repeat(64),
    CERTIFICATION_ENCRYPTION_KEY: 'b'.repeat(64),
    CERTIFICATION_QUICKBOOKS_ENVIRONMENT: 'sandbox',
    ENABLE_BACKGROUND_JOBS: 'false',
    ENABLE_ONBOARDING_WORKER: 'false',
    ENABLE_DETECTION_PROCESSOR: 'false',
    ENABLE_BACKGROUND_SYNC: 'false',
    ENABLE_EVIDENCE_INGESTION_WORKER: 'false',
    ENABLE_DOCUMENT_PARSING_WORKER: 'false',
    ENABLE_EVIDENCE_MATCHING_WORKER: 'false',
    ENABLE_REFUND_FILING_WORKER: 'false',
    ENABLE_RECOVERIES_WORKER: 'false',
    ENABLE_BILLING_WORKER: 'false',
    ENABLE_LEARNING_WORKER: 'false',
    ENABLE_WEEKLY_SUMMARY: 'false',
    ENABLE_SCHEDULED_SYNC: 'false',
    ENABLE_SCHEDULED_INGESTION: 'false',
    ENABLE_PRODUCT_UPDATE_BROADCAST_RECOVERY: 'false',
    ENABLE_AGENT10_SCHEMA_BOOTSTRAP: 'false',
  };
}

afterEach(() => {
  process.env = ORIGINAL_ENV;
});

describe('production-adjacent certification sidecar configuration', () => {
  it('is disabled unless explicitly enabled', () => {
    process.env = { NODE_ENV: 'production' };
    expect(isCertificationSidecarEnabled()).toBe(false);
    expect(loadCertificationSidecarConfig().enabled).toBe(false);
  });

  it('accepts only explicit isolated dependencies with every ordinary worker control disabled', () => {
    process.env = completeSidecarEnvironment();
    const config = loadCertificationSidecarConfig();
    expect(config.enabled).toBe(true);
    expect(config.queueName).toBe('margin-certification-onboarding-sync');
    expect(config.quickBooks.environment).toBe('sandbox');
  });

  it('refuses a sidecar that could start ordinary background jobs', () => {
    process.env = { ...completeSidecarEnvironment(), ENABLE_SCHEDULED_SYNC: 'true' };
    expect(() => loadCertificationSidecarConfig()).toThrow('ENABLE_SCHEDULED_SYNC=false');
  });

  it('refuses a global Redis or database swap', () => {
    const env = completeSidecarEnvironment();
    process.env = { ...env, CERTIFICATION_REDIS_URL: env.REDIS_URL };
    expect(() => loadCertificationSidecarConfig()).toThrow('CERTIFICATION_REDIS_URL must differ from REDIS_URL');

    process.env = { ...env, CERTIFICATION_DATABASE_URL: env.DATABASE_URL };
    expect(() => loadCertificationSidecarConfig()).toThrow('CERTIFICATION_DATABASE_URL must differ from DATABASE_URL');
  });
});
