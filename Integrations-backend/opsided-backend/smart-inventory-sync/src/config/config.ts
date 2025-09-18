import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

export interface ServiceConfig {
  server: {
    port: number;
    host: string;
    environment: string;
    corsOrigins: string[];
  };
  database: {
    host: string;
    port: number;
    name: string;
    user: string;
    password: string;
    ssl: boolean;
    maxConnections: number;
    idleTimeout: number;
  };
  amazon: {
    clientId: string;
    clientSecret: string;
    region: string;
    marketplaceId: string;
    apiEndpoint: string;
    rateLimitDelay: number;
    maxRetries: number;
    timeout: number;
  };
  sync: {
    defaultSchedule: string;
    discrepancySchedule: string;
    maxConcurrentJobs: number;
    jobTimeout: number;
    retryAttempts: number;
    retryDelay: number;
    cleanupInterval: number;
    maxJobAge: number;
  };
  monitoring: {
    enableMetrics: boolean;
    metricsPort: number;
    healthCheckInterval: number;
    logLevel: string;
    enableStructuredLogging: boolean;
  };
  security: {
    enableRateLimiting: boolean;
    rateLimitWindow: number;
    rateLimitMax: number;
    enableHelmet: boolean;
    enableCors: boolean;
    jwtSecret: string;
    jwtExpiry: string;
  };
}

export const config: ServiceConfig = {
  server: {
    port: parseInt(process.env.PORT || '3002'),
    host: process.env.HOST || '0.0.0.0',
    environment: process.env.NODE_ENV || 'development',
    corsOrigins: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
  },
  
  database: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    name: process.env.DB_NAME || 'opsided_integrations',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    ssl: process.env.DB_SSL === 'true',
    maxConnections: parseInt(process.env.DB_MAX_CONNECTIONS || '20'),
    idleTimeout: parseInt(process.env.DB_IDLE_TIMEOUT || '30000'),
  },
  
  amazon: {
    clientId: process.env.AMAZON_CLIENT_ID || '',
    clientSecret: process.env.AMAZON_CLIENT_SECRET || '',
    region: process.env.AMAZON_REGION || 'us-east-1',
    marketplaceId: process.env.AMAZON_MARKETPLACE_ID || '',
    apiEndpoint: process.env.AMAZON_API_ENDPOINT || 'https://sellingpartnerapi-na.amazon.com',
    rateLimitDelay: parseInt(process.env.AMAZON_RATE_LIMIT_DELAY || '1000'),
    maxRetries: parseInt(process.env.AMAZON_MAX_RETRIES || '3'),
    timeout: parseInt(process.env.AMAZON_TIMEOUT || '30000'),
  },
  
  sync: {
    defaultSchedule: process.env.SYNC_DEFAULT_SCHEDULE || '0 */6 * * *', // Every 6 hours
    discrepancySchedule: process.env.SYNC_DISCREPANCY_SCHEDULE || '0 */2 * * *', // Every 2 hours
    maxConcurrentJobs: parseInt(process.env.SYNC_MAX_CONCURRENT_JOBS || '5'),
    jobTimeout: parseInt(process.env.SYNC_JOB_TIMEOUT || '300000'), // 5 minutes
    retryAttempts: parseInt(process.env.SYNC_RETRY_ATTEMPTS || '3'),
    retryDelay: parseInt(process.env.SYNC_RETRY_DELAY || '5000'), // 5 seconds
    cleanupInterval: parseInt(process.env.SYNC_CLEANUP_INTERVAL || '3600000'), // 1 hour
    maxJobAge: parseInt(process.env.SYNC_MAX_JOB_AGE || '86400000'), // 24 hours
  },
  
  monitoring: {
    enableMetrics: process.env.ENABLE_METRICS !== 'false',
    metricsPort: parseInt(process.env.METRICS_PORT || '9090'),
    healthCheckInterval: parseInt(process.env.HEALTH_CHECK_INTERVAL || '30000'), // 30 seconds
    logLevel: process.env.LOG_LEVEL || 'info',
    enableStructuredLogging: process.env.ENABLE_STRUCTURED_LOGGING !== 'false',
  },
  
  security: {
    enableRateLimiting: process.env.ENABLE_RATE_LIMITING !== 'false',
    rateLimitWindow: parseInt(process.env.RATE_LIMIT_WINDOW || '900000'), // 15 minutes
    rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX || '100'),
    enableHelmet: process.env.ENABLE_HELMET !== 'false',
    enableCors: process.env.ENABLE_CORS !== 'false',
    jwtSecret: process.env.JWT_SECRET || 'your-secret-key-change-in-production',
    jwtExpiry: process.env.JWT_EXPIRY || '24h',
  },
};

// Validation function to ensure required configuration is present
export function validateConfig(): void {
  const requiredFields = [
    'AMAZON_CLIENT_ID',
    'AMAZON_CLIENT_SECRET',
    'AMAZON_MARKETPLACE_ID',
    'DB_PASSWORD',
  ];

  const missingFields = requiredFields.filter(field => !process.env[field]);
  
  if (missingFields.length > 0) {
    throw new Error(`Missing required environment variables: ${missingFields.join(', ')}`);
  }
}

// Helper function to get environment-specific configuration
export function getEnvironmentConfig(): Partial<ServiceConfig> {
  const env = config.server.environment;
  
  switch (env) {
    case 'production':
      return {
        monitoring: {
          ...config.monitoring,
          logLevel: 'warn',
          enableStructuredLogging: true,
        },
        security: {
          ...config.security,
          enableRateLimiting: true,
          enableHelmet: true,
        },
      };
      
    case 'staging':
      return {
        monitoring: {
          ...config.monitoring,
          logLevel: 'info',
          enableStructuredLogging: true,
        },
        security: {
          ...config.security,
          enableRateLimiting: true,
          enableHelmet: true,
        },
      };
      
    case 'development':
    default:
      return {
        monitoring: {
          ...config.monitoring,
          logLevel: 'debug',
          enableStructuredLogging: false,
        },
        security: {
          ...config.security,
          enableRateLimiting: false,
          enableHelmet: false,
        },
      };
  }
}

// Export default configuration
export default config;

