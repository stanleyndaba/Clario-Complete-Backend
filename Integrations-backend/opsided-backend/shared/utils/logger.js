"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupLogRotation = exports.logSyncOperation = exports.logExternalApiCall = exports.logDatabaseQuery = exports.logRequest = exports.getStripeLogger = exports.getGmailLogger = exports.getAmazonLogger = exports.createHttpLogger = exports.getLogger = void 0;
const winston_1 = __importDefault(require("winston"));
const winston_daily_rotate_file_1 = __importDefault(require("winston-daily-rotate-file"));
const path_1 = __importDefault(require("path"));
const env_1 = __importDefault(require("../../integration-backend/src/config/env"));
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
const consoleFormat = winston_1.default.format.combine(winston_1.default.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), winston_1.default.format.colorize({ all: true }), winston_1.default.format.printf(({ timestamp, level, message, ...meta }) => {
    let log = `${timestamp} [${level}]: ${message}`;
    if (Object.keys(meta).length > 0) {
        log += ` ${JSON.stringify(meta, null, 2)}`;
    }
    return log;
}));
const fileFormat = winston_1.default.format.combine(winston_1.default.format.timestamp(), winston_1.default.format.errors({ stack: true }), winston_1.default.format.json());
const httpFormat = winston_1.default.format.combine(winston_1.default.format.timestamp(), winston_1.default.format.printf(({ timestamp, level, message, method, url, status, responseTime, ip, userAgent }) => {
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
}));
// ========================================
// TRANSPORTS
// ========================================
const createTransports = () => {
    const transports = [];
    // Console transport for development
    if (env_1.default.NODE_ENV !== 'production') {
        transports.push(new winston_1.default.transports.Console({
            level: env_1.default.LOG_LEVEL,
            format: consoleFormat
        }));
    }
    // File transports
    const logDir = path_1.default.join(process.cwd(), 'logs');
    // General application logs
    transports.push(new winston_daily_rotate_file_1.default({
        filename: path_1.default.join(logDir, 'application-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        maxSize: env_1.default.LOG_MAX_SIZE,
        maxFiles: env_1.default.LOG_MAX_FILES,
        level: env_1.default.LOG_LEVEL,
        format: fileFormat,
        zippedArchive: true
    }));
    // Error logs
    transports.push(new winston_daily_rotate_file_1.default({
        filename: path_1.default.join(logDir, 'error-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        maxSize: env_1.default.LOG_MAX_SIZE,
        maxFiles: env_1.default.LOG_MAX_FILES,
        level: 'error',
        format: fileFormat,
        zippedArchive: true
    }));
    // HTTP request logs
    transports.push(new winston_daily_rotate_file_1.default({
        filename: path_1.default.join(logDir, 'http-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        maxSize: env_1.default.LOG_MAX_SIZE,
        maxFiles: env_1.default.LOG_MAX_FILES,
        level: 'http',
        format: httpFormat,
        zippedArchive: true
    }));
    // Integration-specific logs
    if (env_1.default.NODE_ENV === 'production') {
        // Amazon API logs
        transports.push(new winston_daily_rotate_file_1.default({
            filename: path_1.default.join(logDir, 'amazon-api-%DATE%.log'),
            datePattern: 'YYYY-MM-DD',
            maxSize: env_1.default.LOG_MAX_SIZE,
            maxFiles: env_1.default.LOG_MAX_FILES,
            level: 'info',
            format: fileFormat,
            zippedArchive: true
        }));
        // Gmail API logs
        transports.push(new winston_daily_rotate_file_1.default({
            filename: path_1.default.join(logDir, 'gmail-api-%DATE%.log'),
            datePattern: 'YYYY-MM-DD',
            maxSize: env_1.default.LOG_MAX_SIZE,
            maxFiles: env_1.default.LOG_MAX_FILES,
            level: 'info',
            format: fileFormat,
            zippedArchive: true
        }));
        // Stripe API logs
        transports.push(new winston_daily_rotate_file_1.default({
            filename: path_1.default.join(logDir(), 'stripe-api-%DATE%.log'),
            datePattern: 'YYYY-MM-DD',
            maxSize: env_1.default.LOG_MAX_SIZE,
            maxFiles: env_1.default.LOG_MAX_FILES,
            level: 'info',
            format: fileFormat,
            zippedArchive: true
        }));
    }
    return transports;
};
// ========================================
// LOGGER INSTANCE
// ========================================
const logger = winston_1.default.createLogger({
    level: env_1.default.LOG_LEVEL,
    levels: logLevels,
    format: fileFormat,
    transports: createTransports(),
    exitOnError: false
});
// Add colors for console output
winston_1.default.addColors(logColors);
// ========================================
// LOGGER FUNCTIONS
// ========================================
const getLogger = (module) => {
    return {
        error: (message, meta) => {
            logger.error(message, { module, ...meta });
        },
        warn: (message, meta) => {
            logger.warn(message, { module, ...meta });
        },
        info: (message, meta) => {
            logger.info(message, { module, ...meta });
        },
        http: (message, meta) => {
            logger.http(message, { module, ...meta });
        },
        debug: (message, meta) => {
            logger.debug(message, { module, ...meta });
        },
        verbose: (message, meta) => {
            logger.verbose(message, { module, ...meta });
        },
        silly: (message, meta) => {
            logger.silly(message, { module, ...meta });
        }
    };
};
exports.getLogger = getLogger;
// ========================================
// HTTP LOGGING MIDDLEWARE
// ========================================
const createHttpLogger = () => {
    return winston_1.default.createLogger({
        level: 'http',
        format: httpFormat,
        transports: [
            new winston_daily_rotate_file_1.default({
                filename: path_1.default.join(process.cwd(), 'logs', 'http-%DATE%.log'),
                datePattern: 'YYYY-MM-DD',
                maxSize: env_1.default.LOG_MAX_SIZE,
                maxFiles: env_1.default.LOG_MAX_FILES,
                zippedArchive: true
            })
        ]
    });
};
exports.createHttpLogger = createHttpLogger;
// ========================================
// INTEGRATION LOGGERS
// ========================================
const getAmazonLogger = () => {
    return winston_1.default.createLogger({
        level: 'info',
        format: fileFormat,
        transports: [
            new winston_daily_rotate_file_1.default({
                filename: path_1.default.join(process.cwd(), 'logs', 'amazon-api-%DATE%.log'),
                datePattern: 'YYYY-MM-DD',
                maxSize: env_1.default.LOG_MAX_SIZE,
                maxFiles: env_1.default.LOG_MAX_FILES,
                zippedArchive: true
            })
        ]
    });
};
exports.getAmazonLogger = getAmazonLogger;
const getGmailLogger = () => {
    return winston_1.default.createLogger({
        level: 'info',
        format: fileFormat,
        transports: [
            new winston_daily_rotate_file_1.default({
                filename: path_1.default.join(process.cwd(), 'logs', 'gmail-api-%DATE%.log'),
                datePattern: 'YYYY-MM-DD',
                maxSize: env_1.default.LOG_MAX_SIZE,
                maxFiles: env_1.default.LOG_MAX_FILES,
                zippedArchive: true
            })
        ]
    });
};
exports.getGmailLogger = getGmailLogger;
const getStripeLogger = () => {
    return winston_1.default.createLogger({
        level: 'info',
        format: fileFormat,
        transports: [
            new winston_daily_rotate_file_1.default({
                filename: path_1.default.join(process.cwd(), 'logs', 'stripe-api-%DATE%.log'),
                datePattern: 'YYYY-MM-DD',
                maxSize: env_1.default.LOG_MAX_SIZE,
                maxFiles: env_1.default.LOG_MAX_FILES,
                zippedArchive: true
            })
        ]
    });
};
exports.getStripeLogger = getStripeLogger;
// ========================================
// LOGGING UTILITIES
// ========================================
const logRequest = (req, res, responseTime) => {
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
    }
    else {
        logger.http('HTTP Request', logData);
    }
};
exports.logRequest = logRequest;
const logDatabaseQuery = (query, params, duration) => {
    logger.debug('Database Query', {
        query,
        params,
        duration: `${duration}ms`
    });
};
exports.logDatabaseQuery = logDatabaseQuery;
const logExternalApiCall = (service, endpoint, method, statusCode, duration, error) => {
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
    }
    else {
        logger.info(`${service} API Call`, logData);
    }
};
exports.logExternalApiCall = logExternalApiCall;
const logSyncOperation = (provider, operation, status, details) => {
    const logData = {
        provider,
        operation,
        status,
        timestamp: new Date().toISOString(),
        ...details
    };
    if (status === 'failed' || status === 'error') {
        logger.error(`${provider} Sync ${operation} Failed`, logData);
    }
    else if (status === 'completed') {
        logger.info(`${provider} Sync ${operation} Completed`, logData);
    }
    else {
        logger.info(`${provider} Sync ${operation} Started`, logData);
    }
};
exports.logSyncOperation = logSyncOperation;
// ========================================
// LOG ROTATION AND CLEANUP
// ========================================
const setupLogRotation = () => {
    // Clean up old log files
    const cleanupOldLogs = () => {
        const fs = require('fs');
        const logDir = path_1.default.join(process.cwd(), 'logs');
        if (fs.existsSync(logDir)) {
            const files = fs.readdirSync(logDir);
            const now = Date.now();
            const maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days
            files.forEach((file) => {
                const filePath = path_1.default.join(logDir, file);
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
exports.setupLogRotation = setupLogRotation;
// ========================================
// EXPORT DEFAULT LOGGER
// ========================================
exports.default = logger;
// File transports
exports.default = logger;
exports.default = logger;
