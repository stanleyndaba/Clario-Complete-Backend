import winston from 'winston';
import path from 'path';
import config from "../config/env";
import { sanitizeLogData } from '../security/logSanitizer';

// Resolve log file path safely to avoid undefined causing path.join errors
const resolvedLogFile = (() => {
  try {
    const candidate = (config as any)?.LOG_FILE as string | undefined;
    if (!candidate || typeof candidate !== 'string' || candidate.trim().length === 0) {
      return null;
    }
    return path.isAbsolute(candidate) ? candidate : path.join(process.cwd(), candidate);
  } catch {
    return null;
  }
})();

// Custom format to sanitize log data
const sanitizeFormat = winston.format((info) => {
  // Sanitize metadata if present
  if (info.metadata) {
    info.metadata = sanitizeLogData(info.metadata);
  }
  // Sanitize message if it contains sensitive data
  if (info.message && typeof info.message === 'string') {
    info.message = sanitizeLogData(info.message);
  }
  return info;
});

const logFormat = winston.format.combine(
  sanitizeFormat(),
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

const logger = winston.createLogger({
  level: config.LOG_LEVEL,
  format: logFormat,
  defaultMeta: { service: 'integrations-backend' },
  transports: [
    // Console transport
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    }),
    // File transport (guarded)
    ...(resolvedLogFile ? [
      new winston.transports.File({
        filename: resolvedLogFile,
        maxsize: 5242880, // 5MB
        maxFiles: 5,
      })
    ] : []),
    // Error file transport
    new winston.transports.File({
      filename: path.join(process.cwd(), 'logs/error.log'),
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    })
  ]
});

// Create logs directory if it doesn't exist (best-effort)
import fs from 'fs';
try {
  const logsDir = path.join(process.cwd(), 'logs');
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }
} catch (e) {
  // Ignore logging directory errors in demo mode
}

export default logger; 

// Named helper to get a contextual child logger for modules expecting getLogger
export const getLogger = (context?: string) => {
  try {
    return context ? logger.child({ context }) : logger;
  } catch {
    return logger;
  }
};
