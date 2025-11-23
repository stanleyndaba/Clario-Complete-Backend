/**
 * Security Headers Middleware
 * 
 * Enforces comprehensive security headers including HSTS, CSP, X-Frame-Options, etc.
 */

import { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger';

export interface SecurityHeadersConfig {
  /** Enable HSTS (Strict-Transport-Security) */
  enableHSTS: boolean;
  /** HSTS max-age in seconds (default: 2 years) */
  hstsMaxAge: number;
  /** Enable CSP (Content-Security-Policy) */
  enableCSP: boolean;
  /** CSP directives */
  cspDirectives: string;
  /** Enable X-Frame-Options */
  enableXFrameOptions: boolean;
  /** X-Frame-Options value */
  xFrameOptions: 'DENY' | 'SAMEORIGIN';
  /** Enable X-Content-Type-Options */
  enableXContentTypeOptions: boolean;
  /** Enable Referrer-Policy */
  enableReferrerPolicy: boolean;
  /** Referrer-Policy value */
  referrerPolicy: string;
  /** Enable Permissions-Policy */
  enablePermissionsPolicy: boolean;
  /** Permissions-Policy value */
  permissionsPolicy: string;
}

/**
 * Default security headers configuration
 */
const DEFAULT_CONFIG: SecurityHeadersConfig = {
  enableHSTS: process.env.NODE_ENV === 'production',
  hstsMaxAge: 63072000, // 2 years
  enableCSP: true,
  cspDirectives: [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https:",
    "style-src 'self' 'unsafe-inline' https:",
    "img-src 'self' data: https:",
    "font-src 'self' data: https:",
    "connect-src 'self' https:",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "upgrade-insecure-requests",
  ].join('; '),
  enableXFrameOptions: true,
  xFrameOptions: 'DENY',
  enableXContentTypeOptions: true,
  enableReferrerPolicy: true,
  referrerPolicy: 'no-referrer-when-downgrade',
  enablePermissionsPolicy: true,
  permissionsPolicy: [
    'geolocation=()',
    'microphone=()',
    'camera=()',
    'payment=()',
    'usb=()',
    'magnetometer=()',
    'gyroscope=()',
    'speaker=()',
  ].join(', '),
};

/**
 * Get security headers configuration from environment or use defaults
 */
function getSecurityHeadersConfig(): SecurityHeadersConfig {
  const config = { ...DEFAULT_CONFIG };

  // Override with environment variables if provided
  if (process.env.SECURITY_HSTS_ENABLED !== undefined) {
    config.enableHSTS = process.env.SECURITY_HSTS_ENABLED === 'true';
  }

  if (process.env.SECURITY_HSTS_MAX_AGE) {
    config.hstsMaxAge = parseInt(process.env.SECURITY_HSTS_MAX_AGE, 10);
  }

  if (process.env.SECURITY_CSP_DIRECTIVES) {
    config.cspDirectives = process.env.SECURITY_CSP_DIRECTIVES;
  }

  if (process.env.SECURITY_X_FRAME_OPTIONS) {
    config.xFrameOptions = process.env.SECURITY_X_FRAME_OPTIONS as 'DENY' | 'SAMEORIGIN';
  }

  if (process.env.SECURITY_REFERRER_POLICY) {
    config.referrerPolicy = process.env.SECURITY_REFERRER_POLICY;
  }

  return config;
}

/**
 * Middleware to set security headers
 */
export function securityHeadersMiddleware(
  customConfig?: Partial<SecurityHeadersConfig>
) {
  const config = { ...getSecurityHeadersConfig(), ...customConfig };

  return (req: Request, res: Response, next: NextFunction) => {
    try {
      // HSTS (Strict-Transport-Security)
      if (config.enableHSTS && req.secure) {
        res.setHeader(
          'Strict-Transport-Security',
          `max-age=${config.hstsMaxAge}; includeSubDomains; preload`
        );
      }

      // CSP (Content-Security-Policy)
      if (config.enableCSP) {
        res.setHeader('Content-Security-Policy', config.cspDirectives);
      }

      // X-Frame-Options
      if (config.enableXFrameOptions) {
        res.setHeader('X-Frame-Options', config.xFrameOptions);
      }

      // X-Content-Type-Options
      if (config.enableXContentTypeOptions) {
        res.setHeader('X-Content-Type-Options', 'nosniff');
      }

      // Referrer-Policy
      if (config.enableReferrerPolicy) {
        res.setHeader('Referrer-Policy', config.referrerPolicy);
      }

      // Permissions-Policy (formerly Feature-Policy)
      if (config.enablePermissionsPolicy) {
        res.setHeader('Permissions-Policy', config.permissionsPolicy);
      }

      // X-XSS-Protection (legacy, but still useful for older browsers)
      res.setHeader('X-XSS-Protection', '1; mode=block');

      // Remove X-Powered-By header
      res.removeHeader('X-Powered-By');

      next();
    } catch (error: any) {
      logger.error('Error setting security headers', {
        error: error.message,
        stack: error.stack,
      });
      // Continue even if header setting fails
      next();
    }
  };
}

/**
 * Middleware to enforce HTTPS
 */
export interface EnforceHttpsOptions {
  allowLocalhost?: boolean;
  skipPaths?: string[];
}

export function enforceHttpsMiddleware(
  options: EnforceHttpsOptions = {}
) {
  const { allowLocalhost = true, skipPaths = [] } = options;

  return (req: Request, res: Response, next: NextFunction) => {
    // Skip HTTPS enforcement in development
    if (process.env.NODE_ENV !== 'production') {
      return next();
    }

    // Allow explicitly configured health/diagnostic routes to remain HTTP.
    if (skipPaths.some((path) => req.path.startsWith(path))) {
      return next();
    }

    // Check if request is secure
    const isSecure =
      req.secure ||
      req.headers['x-forwarded-proto'] === 'https' ||
      req.headers['x-forwarded-ssl'] === 'on';

    // Allow localhost in development
    const isLocalhost =
      req.hostname === 'localhost' ||
      req.hostname === '127.0.0.1' ||
      req.ip === '127.0.0.1' ||
      req.ip === '::1';

    if (!isSecure && !(allowLocalhost && isLocalhost)) {
      logger.warn('HTTPS enforcement: Redirecting HTTP to HTTPS', {
        hostname: req.hostname,
        ip: req.ip,
        url: req.url,
      });

      // Redirect to HTTPS
      const httpsUrl = `https://${req.hostname}${req.url}`;
      return res.redirect(301, httpsUrl);
    }

    next();
  };
}

/**
 * Middleware to validate TLS version (requires TLS 1.2+)
 */
export function validateTlsMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    // This is typically handled at the reverse proxy/load balancer level
    // But we can check the protocol version if available
    const tlsVersion = (req.socket as any).getProtocol?.();

    if (tlsVersion && tlsVersion < 'TLSv1.2') {
      logger.warn('TLS version too low', {
        tlsVersion,
        ip: req.ip,
        hostname: req.hostname,
      });

      return res.status(426).json({
        error: 'Upgrade Required',
        message: 'TLS 1.2 or higher is required',
      });
    }

    next();
  };
}

