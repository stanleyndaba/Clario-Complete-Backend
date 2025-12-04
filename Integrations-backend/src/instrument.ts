/**
 * Sentry Instrumentation for Node.js
 * 
 * This file must be imported at the very top of your application entry point
 * to ensure Sentry captures all errors and traces from the start.
/**
 * Sentry Instrumentation for Node.js
 * 
 * This file must be imported at the very top of your application entry point
 * to ensure Sentry captures all errors and traces from the start.
 * 
 * Import this file BEFORE any other imports in index.ts:
 *   import './instrument';
 */

import * as Sentry from '@sentry/node';
// Profiling disabled due to Node 25 compatibility issues on Render
// import { nodeProfilingIntegration } from '@sentry/profiling-node';

// Only initialize if DSN is provided
const sentryDsn = process.env.SENTRY_DSN;

if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    environment: process.env.NODE_ENV || 'development',
    release: process.env.APP_VERSION || '1.0.0',

    integrations: [
      // nodeProfilingIntegration(),
    ],

    // Tracing - capture 100% of transactions
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,

    // Profiling disabled
    // profilesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,

    // Setting this option to true will send default PII data to Sentry
    sendDefaultPii: true,

    // Filter out noisy errors
    beforeSend(event, hint) {
      const error = hint?.originalException;

      // Don't send 4xx client errors to Sentry
      if (error && typeof error === 'object' && 'statusCode' in error) {
        const statusCode = (error as any).statusCode;
        if (statusCode >= 400 && statusCode < 500) {
          return null; // Filter out client errors
        }
      }

      // Don't send rate limit errors
      if (error && typeof error === 'object' && 'code' in error) {
        if ((error as any).code === 'SPAPI_RATE_LIMITED') {
          return null; // Filter out rate limit errors
        }
      }

      return event;
    },

    // Attach service context
    initialScope: {
      tags: {
        service: 'clario-node-api',
      },
    },
  });

  console.log('[Sentry] Initialized successfully (profiling disabled)');
} else {
  console.log('[Sentry] DSN not configured - error tracking disabled');
}
