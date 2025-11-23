import jwt, { Algorithm, SignOptions } from 'jsonwebtoken';
import logger from './logger';

const SERVICE_JWT_SECRET = process.env.PYTHON_API_JWT_SECRET || process.env.JWT_SECRET || '';
const SERVICE_JWT_ALGORITHM: Algorithm = (process.env.PYTHON_API_JWT_ALGORITHM as Algorithm) || 'HS256';
const SERVICE_JWT_ISSUER = process.env.PYTHON_API_JWT_ISSUER || 'integrations-backend';
const SERVICE_JWT_AUDIENCE = process.env.PYTHON_API_JWT_AUDIENCE;
const SERVICE_JWT_TTL = process.env.PYTHON_API_JWT_TTL || '5m';
const SERVICE_NAME = process.env.PYTHON_API_SERVICE_NAME || 'integrations-service-worker';
const SERVICE_EMAIL = process.env.PYTHON_API_SERVICE_EMAIL || 'integrations-worker@internal.local';

if (!SERVICE_JWT_SECRET) {
  logger.warn(
    '[PYTHON AUTH] PYTHON_API_JWT_SECRET is not configured. Calls to protected Python API endpoints will fail with 401.'
  );
}

export interface PythonServiceJwtOptions {
  userId: string;
  email?: string | null;
  name?: string | null;
  amazonSellerId?: string | null;
  expiresIn?: string;
  metadata?: Record<string, unknown>;
}

export const isPythonServiceAuthConfigured = (): boolean => Boolean(SERVICE_JWT_SECRET);

const resolveExpiresIn = (value?: string): SignOptions['expiresIn'] => {
  if (!value) {
    return SERVICE_JWT_TTL as SignOptions['expiresIn'];
  }
  const numeric = Number(value);
  return Number.isNaN(numeric) ? (value as SignOptions['expiresIn']) : numeric;
};

export const generatePythonServiceJwt = (options: PythonServiceJwtOptions): string => {
  if (!SERVICE_JWT_SECRET) {
    throw new Error(
      'PYTHON_API_JWT_SECRET (or JWT_SECRET) must be set to call protected Python API endpoints.'
    );
  }

  const payload = {
    user_id: options.userId,
    email: options.email || SERVICE_EMAIL,
    name: options.name || SERVICE_NAME,
    amazon_seller_id: options.amazonSellerId || undefined,
    role: 'service_worker',
    service: SERVICE_NAME,
    metadata: {
      source: options.metadata?.['source'] || SERVICE_NAME,
      ...(options.metadata || {})
    }
  };

  const signOptions: SignOptions = {
    algorithm: SERVICE_JWT_ALGORITHM,
    expiresIn: resolveExpiresIn(options.expiresIn),
    issuer: SERVICE_JWT_ISSUER
  };

  if (SERVICE_JWT_AUDIENCE) {
    signOptions.audience = SERVICE_JWT_AUDIENCE;
  }

  return jwt.sign(payload, SERVICE_JWT_SECRET, signOptions);
};

export const buildPythonServiceAuthHeader = (options: PythonServiceJwtOptions): string => {
  const token = generatePythonServiceJwt(options);
  return `Bearer ${token}`;
};

