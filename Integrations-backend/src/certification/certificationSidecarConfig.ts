import { RedisOptions } from 'ioredis';

const REQUIRED_ACKNOWLEDGEMENT = 'production-adjacent-dependency-isolation';

export interface CertificationSidecarConfig {
  enabled: boolean;
  redisUrl: string;
  databaseUrl: string;
  internalApiKey: string;
  encryptionKey: Buffer;
  queueName: string;
  oauthStatePrefix: string;
  quickBooks: {
    environment: 'sandbox';
    clientId?: string;
    clientSecret?: string;
    redirectUri?: string;
  };
}

function required(name: string): string {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} is required when CERTIFICATION_SIDECAR_ENABLED=true`);
  return value;
}

export function isCertificationSidecarEnabled(environment: NodeJS.ProcessEnv = process.env): boolean {
  return environment.CERTIFICATION_SIDECAR_ENABLED === 'true';
}

export function loadCertificationSidecarConfig(environment: NodeJS.ProcessEnv = process.env): CertificationSidecarConfig {
  if (!isCertificationSidecarEnabled(environment)) {
    return {
      enabled: false,
      redisUrl: '',
      databaseUrl: '',
      internalApiKey: '',
      encryptionKey: Buffer.alloc(0),
      queueName: '',
      oauthStatePrefix: '',
      quickBooks: { environment: 'sandbox' }
    };
  }

  if (environment.CERTIFICATION_RUNTIME === 'true') {
    throw new Error('CERTIFICATION_RUNTIME=true cannot be combined with CERTIFICATION_SIDECAR_ENABLED=true');
  }
  if (environment.CERTIFICATION_SIDECAR_ACKNOWLEDGEMENT !== REQUIRED_ACKNOWLEDGEMENT) {
    throw new Error('CERTIFICATION_SIDECAR_ACKNOWLEDGEMENT must explicitly acknowledge production-adjacent dependency isolation');
  }
  if (environment.ENABLE_BACKGROUND_JOBS !== 'false') {
    throw new Error('ENABLE_BACKGROUND_JOBS=false is required for the certification sidecar');
  }
  if (environment.ENABLE_ONBOARDING_WORKER !== 'false') {
    throw new Error('ENABLE_ONBOARDING_WORKER=false is required so the production onboarding worker cannot start');
  }
  const requiredDisabledFlags = [
    'ENABLE_DETECTION_PROCESSOR',
    'ENABLE_BACKGROUND_SYNC',
    'ENABLE_EVIDENCE_INGESTION_WORKER',
    'ENABLE_DOCUMENT_PARSING_WORKER',
    'ENABLE_EVIDENCE_MATCHING_WORKER',
    'ENABLE_REFUND_FILING_WORKER',
    'ENABLE_RECOVERIES_WORKER',
    'ENABLE_BILLING_WORKER',
    'ENABLE_LEARNING_WORKER',
    'ENABLE_WEEKLY_SUMMARY',
    'ENABLE_SCHEDULED_SYNC',
    'ENABLE_SCHEDULED_INGESTION',
    'ENABLE_PRODUCT_UPDATE_BROADCAST_RECOVERY',
    'ENABLE_AGENT10_SCHEMA_BOOTSTRAP',
  ];
  for (const name of requiredDisabledFlags) {
    if (environment[name] !== 'false') {
      throw new Error(`${name}=false is required for the certification sidecar`);
    }
  }
  if (environment.CERTIFICATION_QUICKBOOKS_ENVIRONMENT !== 'sandbox') {
    throw new Error('CERTIFICATION_QUICKBOOKS_ENVIRONMENT=sandbox is required for the certification sidecar');
  }

  const encryptionKeyText = required('CERTIFICATION_ENCRYPTION_KEY');
  if (!/^[a-f0-9]{64}$/i.test(encryptionKeyText)) {
    throw new Error('CERTIFICATION_ENCRYPTION_KEY must be a 32-byte hex value');
  }

  const databaseUrl = required('CERTIFICATION_DATABASE_URL');
  const redisUrl = required('CERTIFICATION_REDIS_URL');
  if (databaseUrl === String(environment.DATABASE_URL || '').trim()) {
    throw new Error('CERTIFICATION_DATABASE_URL must differ from DATABASE_URL');
  }
  if (redisUrl === String(environment.REDIS_URL || '').trim()) {
    throw new Error('CERTIFICATION_REDIS_URL must differ from REDIS_URL');
  }
  const internalApiKey = required('CERTIFICATION_INTERNAL_API_KEY');
  const configuredQueueName = String(environment.CERTIFICATION_QUEUE_NAME || 'margin-certification-onboarding-sync').trim();
  if (configuredQueueName === 'onboarding-sync') {
    throw new Error('CERTIFICATION_QUEUE_NAME must differ from the production onboarding queue name');
  }

  return {
    enabled: true,
    redisUrl,
    databaseUrl,
    internalApiKey,
    encryptionKey: Buffer.from(encryptionKeyText, 'hex'),
    queueName: configuredQueueName,
    oauthStatePrefix: `${configuredQueueName}:oauth-state:`,
    quickBooks: {
      environment: 'sandbox',
      clientId: environment.CERTIFICATION_QUICKBOOKS_CLIENT_ID?.trim() || undefined,
      clientSecret: environment.CERTIFICATION_QUICKBOOKS_CLIENT_SECRET?.trim() || undefined,
      redirectUri: environment.CERTIFICATION_QUICKBOOKS_REDIRECT_URI?.trim() || undefined,
    }
  };
}

export function redisOptionsFromUrl(redisUrl: string): RedisOptions {
  const parsed = new URL(redisUrl);
  if (parsed.protocol !== 'redis:' && parsed.protocol !== 'rediss:') {
    throw new Error('CERTIFICATION_REDIS_URL must use redis:// or rediss://');
  }
  return {
    host: parsed.hostname,
    port: Number(parsed.port || '6379'),
    username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
    password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
    maxRetriesPerRequest: null,
    ...(parsed.protocol === 'rediss:' ? { tls: { rejectUnauthorized: false } } : {})
  };
}

export function requireQuickBooksCertificationConfig(config: CertificationSidecarConfig): Required<CertificationSidecarConfig['quickBooks']> {
  if (!config.quickBooks.clientId || !config.quickBooks.clientSecret || !config.quickBooks.redirectUri) {
    throw new Error('QuickBooks certification configuration is incomplete');
  }
  return {
    environment: 'sandbox',
    clientId: config.quickBooks.clientId,
    clientSecret: config.quickBooks.clientSecret,
    redirectUri: config.quickBooks.redirectUri,
  };
}
