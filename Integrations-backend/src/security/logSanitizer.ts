/**
 * Log Sanitization Utility
 * 
 * Removes tokens, passwords, PII, and other sensitive data from logs
 */

import logger from '../utils/logger';

/**
 * Patterns to identify sensitive data
 */
const SENSITIVE_PATTERNS = [
  // Tokens
  /(?:access[_-]?token|refresh[_-]?token|bearer[_-]?token|auth[_-]?token)\s*[:=]\s*['"]?([a-zA-Z0-9\-_.~+/=]+)['"]?/gi,
  // API Keys
  /(?:api[_-]?key|apikey|secret[_-]?key|client[_-]?secret)\s*[:=]\s*['"]?([a-zA-Z0-9\-_.~+/=]+)['"]?/gi,
  // Passwords
  /(?:password|pwd|pass)\s*[:=]\s*['"]?([^'"]+)['"]?/gi,
  // Amazon tokens
  /(?:amzn1\.|Atzr\|)([a-zA-Z0-9\-_.~+/=]+)/gi,
  // JWT tokens
  /(?:eyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+)/g,
  // OAuth codes
  /(?:code|authorization[_-]?code)\s*[:=]\s*['"]?([a-zA-Z0-9\-_.~+/=]+)['"]?/gi,
  // Database connection strings
  /(?:postgresql?|mysql|mongodb):\/\/[^:]+:[^@]+@/gi,
  // Email addresses (optional - may want to keep for some logs)
  // /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g,
];

/**
 * Replacement values for sensitive data
 */
const REPLACEMENTS = {
  token: '[REDACTED_TOKEN]',
  password: '[REDACTED_PASSWORD]',
  apiKey: '[REDACTED_API_KEY]',
  email: '[REDACTED_EMAIL]',
  connectionString: '[REDACTED_CONNECTION_STRING]',
  default: '[REDACTED]',
};

/**
 * Sanitize a string by removing sensitive data
 */
export function sanitizeString(value: string): string {
  if (typeof value !== 'string') {
    return value;
  }

  let sanitized = value;

  // Replace sensitive patterns
  for (const pattern of SENSITIVE_PATTERNS) {
    sanitized = sanitized.replace(pattern, (match, captured) => {
      if (pattern.source.includes('token')) {
        return match.replace(captured || match, REPLACEMENTS.token);
      } else if (pattern.source.includes('password') || pattern.source.includes('pwd') || pattern.source.includes('pass')) {
        return match.replace(captured || match, REPLACEMENTS.password);
      } else if (pattern.source.includes('api') || pattern.source.includes('secret') || pattern.source.includes('key')) {
        return match.replace(captured || match, REPLACEMENTS.apiKey);
      } else if (pattern.source.includes('postgresql') || pattern.source.includes('mysql') || pattern.source.includes('mongodb')) {
        return REPLACEMENTS.connectionString;
      }
      return match.replace(captured || match, REPLACEMENTS.default);
    });
  }

  return sanitized;
}

/**
 * Sanitize an object recursively
 */
export function sanitizeObject(obj: any, depth: number = 0): any {
  // Prevent infinite recursion
  if (depth > 10) {
    return '[MAX_DEPTH_REACHED]';
  }

  if (obj === null || obj === undefined) {
    return obj;
  }

  // Handle strings
  if (typeof obj === 'string') {
    return sanitizeString(obj);
  }

  // Handle arrays
  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeObject(item, depth + 1));
  }

  // Handle objects
  if (typeof obj === 'object') {
    const sanitized: any = {};
    for (const [key, value] of Object.entries(obj)) {
      // Skip sensitive keys entirely or redact their values
      const lowerKey = key.toLowerCase();
      if (
        lowerKey.includes('token') ||
        lowerKey.includes('password') ||
        lowerKey.includes('secret') ||
        lowerKey.includes('key') ||
        lowerKey.includes('auth') ||
        lowerKey.includes('credential')
      ) {
        sanitized[key] = REPLACEMENTS.default;
      } else {
        sanitized[key] = sanitizeObject(value, depth + 1);
      }
    }
    return sanitized;
  }

  // Return primitive values as-is
  return obj;
}

/**
 * Sanitize log data before logging
 */
export function sanitizeLogData(data: any): any {
  try {
    return sanitizeObject(data);
  } catch (error) {
    logger.error('Error sanitizing log data', { error });
    return { error: 'Failed to sanitize log data' };
  }
}

/**
 * Check if a string contains sensitive data
 */
export function containsSensitiveData(value: string): boolean {
  if (typeof value !== 'string') {
    return false;
  }

  for (const pattern of SENSITIVE_PATTERNS) {
    if (pattern.test(value)) {
      return true;
    }
  }

  return false;
}

/**
 * Sanitize error objects
 */
export function sanitizeError(error: any): any {
  if (!error) {
    return error;
  }

  const sanitized: any = {
    name: error.name,
    message: sanitizeString(error.message || ''),
  };

  if (error.stack) {
    sanitized.stack = sanitizeString(error.stack);
  }

  if (error.response) {
    sanitized.response = {
      status: error.response.status,
      statusText: error.response.statusText,
      data: sanitizeObject(error.response.data),
    };
  }

  return sanitized;
}

