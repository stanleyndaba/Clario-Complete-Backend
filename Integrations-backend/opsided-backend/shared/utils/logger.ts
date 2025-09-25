import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import path from 'path';
import config from '../../integration-backend/src/config/env';

// ========================================
// LOG LEVELS
// ========================================

const logLevels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
  verbose: 5,
  silly: 6
};

const logColors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'blue',
  verbose: 'cyan',
  silly: 'white'
};

// ========================================
// LOG FORMATS
// ========================================

const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.colorize({ all: true }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let log = `${timestamp} [${level}]: ${message}`;
    
    if (Object.keys(meta).length > 0) {
      log += ` ${JSON.stringify(meta, null, 2)}`;
    }
    
    return log;
  })
);

const fileFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

const httpFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.printf(({ timestamp, level, message, method, url, status, responseTime, ip, userAgent }) => {
    return JSON.stringify({
      timestamp,
      level,
      message,
      method,
      url,
      status,
      responseTime,
      ip,
      userAgent
    });
  })
);

// ========================================
// TRANSPORTS
// ========================================

const createTransports = () => {
  const transports: winston.transport[] = [];

  // Console transport for development
  if (config.NODE_ENV !== 'production') {
    transports.push(
      new winston.transports.Console({
        level: config.LOG_LEVEL,
        format: consoleFormat
      })
    );
  }

  // File transports
  const logDir = path.join(process.cwd(), 'logs');

  // General application logs
  transports.push(
    new DailyRotateFile({
      filename: path.join(logDir, 'application-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxSize: config.LOG_MAX_SIZE,
      maxFiles: config.LOG_MAX_FILES,
      level: config.LOG_LEVEL,
      format: fileFormat,
      zippedArchive: true
    })
  );

  // Error logs
  transports.push(
    new DailyRotateFile({
      filename: path.join(logDir, 'error-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxSize: config.LOG_MAX_SIZE,
      maxFiles: config.LOG_MAX_FILES,
      level: 'error',
      format: fileFormat,
      zippedArchive: true
    })
  );

  // HTTP request logs
  transports.push(
    new DailyRotateFile({
      filename: path.join(logDir, 'http-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxSize: config.LOG_MAX_SIZE,
      maxFiles: config.LOG_MAX_FILES,
      level: 'http',
      format: httpFormat,
      zippedArchive: true
    })
  );

  // Integration-specific logs
  if (config.NODE_ENV === 'production') {
    // Amazon API logs
    transports.push(
      new DailyRotateFile({
        filename: path.join(logDir, 'amazon-api-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        maxSize: config.LOG_MAX_SIZE,
        maxFiles: config.LOG_MAX_FILES,
        level: 'info',
        format: fileFormat,
        zippedArchive: true
      })
    );

    // Gmail API logs
    transports.push(
      new DailyRotateFile({
        filename: path.join(logDir, 'gmail-api-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        maxSize: config.LOG_MAX_SIZE,
        maxFiles: config.LOG_MAX_FILES,
        level: 'info',
        format: fileFormat,
        zippedArchive: true
      })
    );

    // Stripe API logs
    transports.push(
      new DailyRotateFile({
        filename: path.join(logDir(), 'stripe-api-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        maxSize: config.LOG_MAX_SIZE,
        maxFiles: config.LOG_MAX_FILES,
        level: 'info',
        format: fileFormat,
        zippedArchive: true
      })
    );
  }

  return transports;
};

// ========================================
// LOGGER INSTANCE
// ========================================

const logger = winston.createLogger({
  level: config.LOG_LEVEL,
  levels: logLevels,
  format: fileFormat,
  transports: createTransports(),
  exitOnError: false
});

// Add colors for console output
winston.addColors(logColors);

// ========================================
// LOGGER FUNCTIONS
// ========================================

export const getLogger = (module: string) => {
  return {
    error: (message: string, meta?: any) => {
      logger.error(message, { module, ...meta });
    },
    warn: (message: string, meta?: any) => {
      logger.warn(message, { module, ...meta });
    },
    info: (message: string, meta?: any) => {
      logger.info(message, { module, ...meta });
    },
    http: (message: string, meta?: any) => {
      logger.http(message, { module, ...meta });
    },
    debug: (message: string, meta?: any) => {
      logger.debug(message, { module, ...meta });
    },
    verbose: (message: string, meta?: any) => {
      logger.verbose(message, { module, ...meta });
    },
    silly: (message: string, meta?: any) => {
      logger.silly(message, { module, ...meta });
    }
  };
};

// ========================================
// HTTP LOGGING MIDDLEWARE
// ========================================

export const createHttpLogger = () => {
  return winston.createLogger({
    level: 'http',
    format: httpFormat,
    transports: [
      new DailyRotateFile({
        filename: path.join(process.cwd(), 'logs', 'http-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        maxSize: config.LOG_MAX_SIZE,
        maxFiles: config.LOG_MAX_FILES,
        zippedArchive: true
      })
    ]
  });
};

// ========================================
// INTEGRATION LOGGERS
// ========================================

export const getAmazonLogger = () => {
  return winston.createLogger({
    level: 'info',
    format: fileFormat,
    transports: [
      new DailyRotateFile({
        filename: path.join(process.cwd(), 'logs', 'amazon-api-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        maxSize: config.LOG_MAX_SIZE,
        maxFiles: config.LOG_MAX_FILES,
        zippedArchive: true
      })
    ]
  });
};

export const getGmailLogger = () => {
  return winston.createLogger({
    level: 'info',
    format: fileFormat,
    transports: [
      new DailyRotateFile({
        filename: path.join(process.cwd(), 'logs', 'gmail-api-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        maxSize: config.LOG_MAX_SIZE,
        maxFiles: config.LOG_MAX_FILES,
        zippedArchive: true
      })
    ]
  });
};

export const getStripeLogger = () => {
  return winston.createLogger({
    level: 'info',
    format: fileFormat,
    transports: [
      new DailyRotateFile({
        filename: path.join(process.cwd(), 'logs', 'stripe-api-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        maxSize: config.LOG_MAX_SIZE,
        maxFiles: config.LOG_MAX_FILES,
        zippedArchive: true
      })
    ]
  });
};

// ========================================
// LOGGING UTILITIES
// ========================================

export const logRequest = (req: any, res: any, responseTime: number) => {
  const logData = {
    method: req.method,
    url: req.originalUrl || req.url,
    status: res.statusCode,
    responseTime: `${responseTime}ms`,
    ip: req.ip || req.connection.remoteAddress,
    userAgent: req.get('User-Agent'),
    userId: req.user?.id,
    requestId: req.headers['x-request-id']
  };

  if (res.statusCode >= 400) {
    logger.error('HTTP Request Error', logData);
  } else {
    logger.http('HTTP Request', logData);
  }
};

export const logDatabaseQuery = (query: string, params: any[], duration: number) => {
  logger.debug('Database Query', {
    query,
    params,
    duration: `${duration}ms`
  });
};

export const logExternalApiCall = (service: string, endpoint: string, method: string, statusCode: number, duration: number, error?: any) => {
  const logData = {
    service,
    endpoint,
    method,
    statusCode,
    duration: `${duration}ms`,
    error: error ? error.message : undefined
  };

  if (statusCode >= 400 || error) {
    logger.error(`${service} API Error`, logData);
  } else {
    logger.info(`${service} API Call`, logData);
  }
};

export const logSyncOperation = (provider: string, operation: string, status: string, details: any) => {
  const logData = {
    provider,
    operation,
    status,
    timestamp: new Date().toISOString(),
    ...details
  };

  if (status === 'failed' || status === 'error') {
    logger.error(`${provider} Sync ${operation} Failed`, logData);
  } else if (status === 'completed') {
    logger.info(`${provider} Sync ${operation} Completed`, logData);
  } else {
    logger.info(`${provider} Sync ${operation} Started`, logData);
  }
};

// ========================================
// LOG ROTATION AND CLEANUP
// ========================================

export const setupLogRotation = () => {
  // Clean up old log files
  const cleanupOldLogs = () => {
    const fs = require('fs');
    const logDir = path.join(process.cwd(), 'logs');
    
    if (fs.existsSync(logDir)) {
      const files = fs.readdirSync(logDir);
      const now = Date.now();
      const maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days
      
      files.forEach((file: string) => {
        const filePath = path.join(logDir, file);
        const stats = fs.statSync(filePath);
        
        if (now - stats.mtime.getTime() > maxAge) {
          fs.unlinkSync(filePath);
          logger.info(`Cleaned up old log file: ${file}`);
        }
      });
    }
  };

  // Run cleanup daily
  setInterval(cleanupOldLogs, 24 * 60 * 60 * 1000);
  
  // Initial cleanup
  cleanupOldLogs();
};

// ========================================
// EXPORT DEFAULT LOGGER
// ========================================

export default logger; 