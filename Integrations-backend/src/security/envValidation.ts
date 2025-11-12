/**
 * Environment Variable Validation
 * 
 * Validates that all required environment variables are set at startup
 */

import logger from '../utils/logger';

export interface EnvValidationRule {
  name: string;
  required: boolean;
  validator?: (value: string) => boolean;
  errorMessage?: string;
  sensitive?: boolean; // Don't log the value if sensitive
}

/**
 * Required environment variables for production
 */
const REQUIRED_ENV_VARS: EnvValidationRule[] = [
  {
    name: 'AMAZON_CLIENT_ID',
    required: true,
    validator: (value) => value.startsWith('amzn1.') || value.length > 0,
    errorMessage: 'AMAZON_CLIENT_ID must be a valid Amazon client ID',
    sensitive: false,
  },
  {
    name: 'AMAZON_CLIENT_SECRET',
    required: true,
    validator: (value) => value.startsWith('amzn1.') || value.length > 0,
    errorMessage: 'AMAZON_CLIENT_SECRET must be a valid Amazon client secret',
    sensitive: true,
  },
  {
    name: 'AMAZON_SPAPI_REFRESH_TOKEN',
    required: true,
    validator: (value) => value.startsWith('Atzr|') || value.length > 0,
    errorMessage: 'AMAZON_SPAPI_REFRESH_TOKEN must be a valid refresh token',
    sensitive: true,
  },
  {
    name: 'JWT_SECRET',
    required: true,
    validator: (value) => value.length >= 32,
    errorMessage: 'JWT_SECRET must be at least 32 characters',
    sensitive: true,
  },
  {
    name: 'DATABASE_URL',
    required: true,
    validator: (value) => value.startsWith('postgresql://') || value.startsWith('postgres://'),
    errorMessage: 'DATABASE_URL must be a valid PostgreSQL connection string',
    sensitive: true,
  },
];

/**
 * Optional but recommended environment variables
 */
const RECOMMENDED_ENV_VARS: EnvValidationRule[] = [
  {
    name: 'AMAZON_REDIRECT_URI',
    required: false,
    validator: (value) => value.startsWith('https://') || value.startsWith('http://localhost'),
    errorMessage: 'AMAZON_REDIRECT_URI should use HTTPS in production',
  },
  {
    name: 'FRONTEND_URL',
    required: false,
    validator: (value) => value.startsWith('https://') || value.startsWith('http://localhost'),
    errorMessage: 'FRONTEND_URL should use HTTPS in production',
  },
];

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate environment variables
 */
export function validateEnvironment(
  isProduction: boolean = process.env.NODE_ENV === 'production'
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Validate required variables
  for (const rule of REQUIRED_ENV_VARS) {
    const value = process.env[rule.name];

    if (!value || value.trim() === '') {
      if (rule.required) {
        errors.push(`Required environment variable ${rule.name} is not set`);
      }
      continue;
    }

    // Check for placeholder values
    if (
      value.includes('your-') ||
      value.includes('placeholder') ||
      value.includes('change-in-production') ||
      value === 'test' ||
      value === 'dev'
    ) {
      if (isProduction) {
        errors.push(
          `Environment variable ${rule.name} appears to be a placeholder value`
        );
      } else {
        warnings.push(
          `Environment variable ${rule.name} appears to be a placeholder value`
        );
      }
      continue;
    }

    // Validate format if validator provided
    if (rule.validator && !rule.validator(value)) {
      errors.push(
        rule.errorMessage ||
          `Environment variable ${rule.name} has invalid format`
      );
    }
  }

  // Validate recommended variables (warnings only)
  if (isProduction) {
    for (const rule of RECOMMENDED_ENV_VARS) {
      const value = process.env[rule.name];

      if (!value || value.trim() === '') {
        warnings.push(
          `Recommended environment variable ${rule.name} is not set`
        );
        continue;
      }

      if (rule.validator && !rule.validator(value)) {
        warnings.push(
          rule.errorMessage ||
            `Environment variable ${rule.name} may have issues: ${value.substring(0, 20)}...`
        );
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate and fail fast if required variables are missing
 */
export function validateEnvironmentOrFail(
  isProduction: boolean = process.env.NODE_ENV === 'production'
): void {
  const result = validateEnvironment(isProduction);

  // Log warnings
  for (const warning of result.warnings) {
    logger.warn('Environment validation warning', { warning });
  }

  // Fail if errors exist
  if (!result.valid) {
    logger.error('Environment validation failed', {
      errors: result.errors,
      isProduction,
    });

    throw new Error(
      `Environment validation failed:\n${result.errors.join('\n')}`
    );
  }

  logger.info('Environment validation passed', {
    isProduction,
    warnings: result.warnings.length,
  });
}

/**
 * Check for hard-coded secrets in environment variables
 */
export function checkForHardcodedSecrets(): string[] {
  const issues: string[] = [];

  // Check for common hard-coded secret patterns
  const secretPatterns = [
    /password/i,
    /secret/i,
    /key/i,
    /token/i,
    /credential/i,
  ];

  for (const [key, value] of Object.entries(process.env)) {
    // Skip if value is empty
    if (!value || value.trim() === '') {
      continue;
    }

    // Check if key suggests it's a secret
    const isSecretKey = secretPatterns.some((pattern) => pattern.test(key));

    if (isSecretKey) {
      // Check for common placeholder values
      if (
        value.includes('your-') ||
        value.includes('placeholder') ||
        value.includes('change-in-production') ||
        value === 'test' ||
        value === 'dev' ||
        value === 'secret' ||
        value === 'password'
      ) {
        issues.push(
          `Environment variable ${key} appears to contain a placeholder value`
        );
      }

      // Check for suspiciously short values
      if (value.length < 16 && key.includes('SECRET')) {
        issues.push(
          `Environment variable ${key} is suspiciously short (${value.length} characters)`
        );
      }
    }
  }

  return issues;
}

