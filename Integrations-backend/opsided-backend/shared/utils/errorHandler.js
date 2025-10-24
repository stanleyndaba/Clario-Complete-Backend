"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mapErrorTypeToHttpStatus = exports.mapHttpStatusToErrorType = exports.handleUnhandledRejections = exports.handleUncaughtExceptions = exports.isOperationalError = exports.asyncHandler = exports.errorHandler = exports.logError = exports.formatErrorResponse = exports.SyncError = exports.ExternalServiceError = exports.NotFoundError = exports.AuthorizationError = exports.AuthenticationError = exports.ValidationError = exports.AppError = exports.ErrorSeverity = exports.ErrorType = void 0;
const logger_1 = require("./logger");
const logger = (0, logger_1.getLogger)('ErrorHandler');
// ========================================
// ERROR TYPES
// ========================================
var ErrorType;
(function (ErrorType) {
    // Authentication & Authorization
    ErrorType["UNAUTHORIZED"] = "UNAUTHORIZED";
    ErrorType["FORBIDDEN"] = "FORBIDDEN";
    ErrorType["INVALID_TOKEN"] = "INVALID_TOKEN";
    ErrorType["TOKEN_EXPIRED"] = "TOKEN_EXPIRED";
    // Validation
    ErrorType["VALIDATION_ERROR"] = "VALIDATION_ERROR";
    ErrorType["INVALID_INPUT"] = "INVALID_INPUT";
    ErrorType["MISSING_REQUIRED_FIELD"] = "MISSING_REQUIRED_FIELD";
    // Business Logic
    ErrorType["BUSINESS_RULE_VIOLATION"] = "BUSINESS_RULE_VIOLATION";
    ErrorType["INSUFFICIENT_PERMISSIONS"] = "INSUFFICIENT_PERMISSIONS";
    ErrorType["RESOURCE_NOT_FOUND"] = "RESOURCE_NOT_FOUND";
    ErrorType["RESOURCE_ALREADY_EXISTS"] = "RESOURCE_ALREADY_EXISTS";
    // External Services
    ErrorType["EXTERNAL_SERVICE_ERROR"] = "EXTERNAL_SERVICE_ERROR";
    ErrorType["AMAZON_API_ERROR"] = "AMAZON_API_ERROR";
    ErrorType["GMAIL_API_ERROR"] = "GMAIL_API_ERROR";
    ErrorType["STRIPE_API_ERROR"] = "STRIPE_API_ERROR";
    // Database
    ErrorType["DATABASE_ERROR"] = "DATABASE_ERROR";
    ErrorType["CONNECTION_ERROR"] = "CONNECTION_ERROR";
    ErrorType["QUERY_ERROR"] = "QUERY_ERROR";
    // Rate Limiting
    ErrorType["RATE_LIMIT_EXCEEDED"] = "RATE_LIMIT_EXCEEDED";
    ErrorType["TOO_MANY_REQUESTS"] = "TOO_MANY_REQUESTS";
    // System
    ErrorType["INTERNAL_SERVER_ERROR"] = "INTERNAL_SERVER_ERROR";
    ErrorType["SERVICE_UNAVAILABLE"] = "SERVICE_UNAVAILABLE";
    ErrorType["TIMEOUT_ERROR"] = "TIMEOUT_ERROR";
    // Integration Specific
    ErrorType["SYNC_ERROR"] = "SYNC_ERROR";
    ErrorType["OAUTH_ERROR"] = "OAUTH_ERROR";
    ErrorType["WEBHOOK_ERROR"] = "WEBHOOK_ERROR";
    ErrorType["ENCRYPTION_ERROR"] = "ENCRYPTION_ERROR";
})(ErrorType || (exports.ErrorType = ErrorType = {}));
var ErrorSeverity;
(function (ErrorSeverity) {
    ErrorSeverity["LOW"] = "low";
    ErrorSeverity["MEDIUM"] = "medium";
    ErrorSeverity["HIGH"] = "high";
    ErrorSeverity["CRITICAL"] = "critical";
})(ErrorSeverity || (exports.ErrorSeverity = ErrorSeverity = {}));
// ========================================
// CUSTOM ERROR CLASSES
// ========================================
class AppError extends Error {
    constructor(message, type, statusCode = 500, severity = ErrorSeverity.MEDIUM, isOperational = true, context, originalError) {
        super(message);
        this.name = this.constructor.name;
        this.type = type;
        this.statusCode = statusCode;
        this.severity = severity;
        this.isOperational = isOperational;
        this.context = context;
        this.originalError = originalError;
        // Maintains proper stack trace for where our error was thrown (only available on V8)
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, this.constructor);
        }
    }
}
exports.AppError = AppError;
class ValidationError extends AppError {
    constructor(message, context) {
        super(message, ErrorType.VALIDATION_ERROR, 400, ErrorSeverity.LOW, true, context);
    }
}
exports.ValidationError = ValidationError;
class AuthenticationError extends AppError {
    constructor(message = 'Authentication required', context) {
        super(message, ErrorType.UNAUTHORIZED, 401, ErrorSeverity.HIGH, true, context);
    }
}
exports.AuthenticationError = AuthenticationError;
class AuthorizationError extends AppError {
    constructor(message = 'Insufficient permissions', context) {
        super(message, ErrorType.FORBIDDEN, 403, ErrorSeverity.HIGH, true, context);
    }
}
exports.AuthorizationError = AuthorizationError;
class NotFoundError extends AppError {
    constructor(resource, context) {
        super(`${resource} not found`, ErrorType.RESOURCE_NOT_FOUND, 404, ErrorSeverity.LOW, true, context);
    }
}
exports.NotFoundError = NotFoundError;
class ExternalServiceError extends AppError {
    constructor(service, message, statusCode, context) {
        super(`${service} service error: ${message}`, ErrorType.EXTERNAL_SERVICE_ERROR, statusCode || 502, ErrorSeverity.HIGH, true, { service, ...context });
    }
}
exports.ExternalServiceError = ExternalServiceError;
class SyncError extends AppError {
    constructor(provider, message, context) {
        super(`${provider} sync error: ${message}`, ErrorType.SYNC_ERROR, 500, ErrorSeverity.HIGH, true, { provider, ...context });
    }
}
exports.SyncError = SyncError;
const formatErrorResponse = (error, req, requestId) => {
    const response = {
        success: false,
        error: {
            type: error.type,
            message: error.message,
            statusCode: error.statusCode,
            severity: error.severity,
            timestamp: new Date().toISOString(),
            requestId,
            path: req?.path,
            method: req?.method,
            context: error.context
        }
    };
    // Remove undefined fields
    Object.keys(response.error).forEach(key => {
        if (response.error[key] === undefined) {
            delete response.error[key];
        }
    });
    return response;
};
exports.formatErrorResponse = formatErrorResponse;
// ========================================
// ERROR LOGGING
// ========================================
const logError = (error, req, requestId) => {
    const logData = {
        type: error.type,
        message: error.message,
        statusCode: error.statusCode,
        severity: error.severity,
        requestId,
        path: req?.path,
        method: req?.method,
        userId: req?.user?.id,
        ip: req?.ip,
        userAgent: req?.get('User-Agent'),
        context: error.context,
        stack: error.stack,
        originalError: error.originalError ? {
            name: error.originalError.name,
            message: error.originalError.message,
            stack: error.originalError.stack
        } : undefined
    };
    switch (error.severity) {
        case ErrorSeverity.CRITICAL:
            logger.error('CRITICAL ERROR:', logData);
            break;
        case ErrorSeverity.HIGH:
            logger.error('HIGH SEVERITY ERROR:', logData);
            break;
        case ErrorSeverity.MEDIUM:
            logger.warn('MEDIUM SEVERITY ERROR:', logData);
            break;
        case ErrorSeverity.LOW:
            logger.info('LOW SEVERITY ERROR:', logData);
            break;
    }
};
exports.logError = logError;
// ========================================
// EXPRESS ERROR HANDLING MIDDLEWARE
// ========================================
const errorHandler = (error, req, res, next) => {
    const requestId = req.headers['x-request-id'];
    // If it's our custom error, handle it
    if (error instanceof AppError) {
        (0, exports.logError)(error, req, requestId);
        res.status(error.statusCode).json((0, exports.formatErrorResponse)(error, req, requestId));
        return;
    }
    // Handle validation errors from express-validator
    if (error.name === 'ValidationError') {
        const validationError = new ValidationError('Validation failed', { details: error.message });
        (0, exports.logError)(validationError, req, requestId);
        res.status(validationError.statusCode).json((0, exports.formatErrorResponse)(validationError, req, requestId));
        return;
    }
    // Handle JWT errors
    if (error.name === 'JsonWebTokenError') {
        const authError = new AuthenticationError('Invalid token');
        (0, exports.logError)(authError, req, requestId);
        res.status(authError.statusCode).json((0, exports.formatErrorResponse)(authError, req, requestId));
        return;
    }
    if (error.name === 'TokenExpiredError') {
        const authError = new AuthenticationError('Token expired');
        (0, exports.logError)(authError, req, requestId);
        res.status(authError.statusCode).json((0, exports.formatErrorResponse)(authError, req, requestId));
        return;
    }
    // Handle unknown errors
    const unknownError = new AppError('Internal server error', ErrorType.INTERNAL_SERVER_ERROR, 500, ErrorSeverity.CRITICAL, false, { originalError: error.message }, error);
    (0, exports.logError)(unknownError, req, requestId);
    res.status(500).json((0, exports.formatErrorResponse)(unknownError, req, requestId));
};
exports.errorHandler = errorHandler;
// ========================================
// ASYNC ERROR WRAPPER
// ========================================
const asyncHandler = (fn) => {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
};
exports.asyncHandler = asyncHandler;
// ========================================
// ERROR UTILITIES
// ========================================
const isOperationalError = (error) => {
    if (error instanceof AppError) {
        return error.isOperational;
    }
    return false;
};
exports.isOperationalError = isOperationalError;
const handleUncaughtExceptions = () => {
    process.on('uncaughtException', (error) => {
        logger.error('UNCAUGHT EXCEPTION:', {
            name: error.name,
            message: error.message,
            stack: error.stack
        });
        // Exit process with failure
        process.exit(1);
    });
};
exports.handleUncaughtExceptions = handleUncaughtExceptions;
const handleUnhandledRejections = () => {
    process.on('unhandledRejection', (reason, promise) => {
        logger.error('UNHANDLED REJECTION:', {
            reason,
            promise: promise.toString()
        });
        // Exit process with failure
        process.exit(1);
    });
};
exports.handleUnhandledRejections = handleUnhandledRejections;
// ========================================
// ERROR MAPPING
// ========================================
const mapHttpStatusToErrorType = (statusCode) => {
    switch (statusCode) {
        case 400: return ErrorType.VALIDATION_ERROR;
        case 401: return ErrorType.UNAUTHORIZED;
        case 403: return ErrorType.FORBIDDEN;
        case 404: return ErrorType.RESOURCE_NOT_FOUND;
        case 429: return ErrorType.RATE_LIMIT_EXCEEDED;
        case 500: return ErrorType.INTERNAL_SERVER_ERROR;
        case 502: return ErrorType.EXTERNAL_SERVICE_ERROR;
        case 503: return ErrorType.SERVICE_UNAVAILABLE;
        case 504: return ErrorType.TIMEOUT_ERROR;
        default: return ErrorType.INTERNAL_SERVER_ERROR;
    }
};
exports.mapHttpStatusToErrorType = mapHttpStatusToErrorType;
const mapErrorTypeToHttpStatus = (errorType) => {
    switch (errorType) {
        case ErrorType.VALIDATION_ERROR:
        case ErrorType.INVALID_INPUT:
        case ErrorType.MISSING_REQUIRED_FIELD:
            return 400;
        case ErrorType.UNAUTHORIZED:
        case ErrorType.INVALID_TOKEN:
        case ErrorType.TOKEN_EXPIRED:
            return 401;
        case ErrorType.FORBIDDEN:
        case ErrorType.INSUFFICIENT_PERMISSIONS:
            return 403;
        case ErrorType.RESOURCE_NOT_FOUND:
            return 404;
        case ErrorType.RESOURCE_ALREADY_EXISTS:
            return 409;
        case ErrorType.RATE_LIMIT_EXCEEDED:
        case ErrorType.TOO_MANY_REQUESTS:
            return 429;
        case ErrorType.EXTERNAL_SERVICE_ERROR:
        case ErrorType.AMAZON_API_ERROR:
        case ErrorType.GMAIL_API_ERROR:
        case ErrorType.STRIPE_API_ERROR:
            return 502;
        case ErrorType.SERVICE_UNAVAILABLE:
            return 503;
        case ErrorType.TIMEOUT_ERROR:
            return 504;
        default:
            return 500;
    }
};
exports.mapErrorTypeToHttpStatus = mapErrorTypeToHttpStatus;
const logger = (0, logger_1.getLogger)('ErrorHandler');
// ========================================
// ERROR TYPES
// ========================================
(function (ErrorType) {
    // Authentication & Authorization
    ErrorType["UNAUTHORIZED"] = "UNAUTHORIZED";
    ErrorType["FORBIDDEN"] = "FORBIDDEN";
    ErrorType["INVALID_TOKEN"] = "INVALID_TOKEN";
    ErrorType["TOKEN_EXPIRED"] = "TOKEN_EXPIRED";
    // Validation
    ErrorType["VALIDATION_ERROR"] = "VALIDATION_ERROR";
    ErrorType["INVALID_INPUT"] = "INVALID_INPUT";
    ErrorType["MISSING_REQUIRED_FIELD"] = "MISSING_REQUIRED_FIELD";
    // Business Logic
    ErrorType["BUSINESS_RULE_VIOLATION"] = "BUSINESS_RULE_VIOLATION";
    ErrorType["INSUFFICIENT_PERMISSIONS"] = "INSUFFICIENT_PERMISSIONS";
    ErrorType["RESOURCE_NOT_FOUND"] = "RESOURCE_NOT_FOUND";
    ErrorType["RESOURCE_ALREADY_EXISTS"] = "RESOURCE_ALREADY_EXISTS";
    // External Services
    ErrorType["EXTERNAL_SERVICE_ERROR"] = "EXTERNAL_SERVICE_ERROR";
    ErrorType["AMAZON_API_ERROR"] = "AMAZON_API_ERROR";
    ErrorType["GMAIL_API_ERROR"] = "GMAIL_API_ERROR";
    ErrorType["STRIPE_API_ERROR"] = "STRIPE_API_ERROR";
    // Database
    ErrorType["DATABASE_ERROR"] = "DATABASE_ERROR";
    ErrorType["CONNECTION_ERROR"] = "CONNECTION_ERROR";
    ErrorType["QUERY_ERROR"] = "QUERY_ERROR";
    // Rate Limiting
    ErrorType["RATE_LIMIT_EXCEEDED"] = "RATE_LIMIT_EXCEEDED";
    ErrorType["TOO_MANY_REQUESTS"] = "TOO_MANY_REQUESTS";
    // System
    ErrorType["INTERNAL_SERVER_ERROR"] = "INTERNAL_SERVER_ERROR";
    ErrorType["SERVICE_UNAVAILABLE"] = "SERVICE_UNAVAILABLE";
    ErrorType["TIMEOUT_ERROR"] = "TIMEOUT_ERROR";
    // Integration Specific
    ErrorType["SYNC_ERROR"] = "SYNC_ERROR";
    ErrorType["OAUTH_ERROR"] = "OAUTH_ERROR";
    ErrorType["WEBHOOK_ERROR"] = "WEBHOOK_ERROR";
    ErrorType["ENCRYPTION_ERROR"] = "ENCRYPTION_ERROR";
})(ErrorType || (exports.ErrorType = ErrorType = {}));
(function (ErrorSeverity) {
    ErrorSeverity["LOW"] = "low";
    ErrorSeverity["MEDIUM"] = "medium";
    ErrorSeverity["HIGH"] = "high";
    ErrorSeverity["CRITICAL"] = "critical";
})(ErrorSeverity || (exports.ErrorSeverity = ErrorSeverity = {}));
// ========================================
// CUSTOM ERROR CLASSES
// ========================================
class AppError extends Error {
    constructor(message, type, statusCode = 500, severity = ErrorSeverity.MEDIUM, isOperational = true, context, originalError) {
        super(message);
        this.name = this.constructor.name;
        this.type = type;
        this.statusCode = statusCode;
        this.severity = severity;
        this.isOperational = isOperational;
        this.context = context;
        this.originalError = originalError;
        // Maintains proper stack trace for where our error was thrown (only available on V8)
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, this.constructor);
        }
    }
}
exports.AppError = AppError;
class ValidationError extends AppError {
    constructor(message, context) {
        super(message, ErrorType.VALIDATION_ERROR, 400, ErrorSeverity.LOW, true, context);
    }
}
exports.ValidationError = ValidationError;
class AuthenticationError extends AppError {
    constructor(message = 'Authentication required', context) {
        super(message, ErrorType.UNAUTHORIZED, 401, ErrorSeverity.HIGH, true, context);
    }
}
exports.AuthenticationError = AuthenticationError;
class AuthorizationError extends AppError {
    constructor(message = 'Insufficient permissions', context) {
        super(message, ErrorType.FORBIDDEN, 403, ErrorSeverity.HIGH, true, context);
    }
}
exports.AuthorizationError = AuthorizationError;
class NotFoundError extends AppError {
    constructor(resource, context) {
        super(`${resource} not found`, ErrorType.RESOURCE_NOT_FOUND, 404, ErrorSeverity.LOW, true, context);
    }
}
exports.NotFoundError = NotFoundError;
class ExternalServiceError extends AppError {
    constructor(service, message, statusCode, context) {
        super(`${service} service error: ${message}`, ErrorType.EXTERNAL_SERVICE_ERROR, statusCode || 502, ErrorSeverity.HIGH, true, { service, ...context });
    }
}
exports.ExternalServiceError = ExternalServiceError;
class SyncError extends AppError {
    constructor(provider, message, context) {
        super(`${provider} sync error: ${message}`, ErrorType.SYNC_ERROR, 500, ErrorSeverity.HIGH, true, { provider, ...context });
    }
}
exports.SyncError = SyncError;
const formatErrorResponse = (error, req, requestId) => {
    const response = {
        success: false,
        error: {
            type: error.type,
            message: error.message,
            statusCode: error.statusCode,
            severity: error.severity,
            timestamp: new Date().toISOString(),
            requestId,
            path: req?.path,
            method: req?.method,
            context: error.context
        }
    };
    // Remove undefined fields
    Object.keys(response.error).forEach(key => {
        if (response.error[key] === undefined) {
            delete response.error[key];
        }
    });
    return response;
};
exports.formatErrorResponse = formatErrorResponse;
// ========================================
// ERROR LOGGING
// ========================================
const logError = (error, req, requestId) => {
    const logData = {
        type: error.type,
        message: error.message,
        statusCode: error.statusCode,
        severity: error.severity,
        requestId,
        path: req?.path,
        method: req?.method,
        userId: req?.user?.id,
        ip: req?.ip,
        userAgent: req?.get('User-Agent'),
        context: error.context,
        stack: error.stack,
        originalError: error.originalError ? {
            name: error.originalError.name,
            message: error.originalError.message,
            stack: error.originalError.stack
        } : undefined
    };
    switch (error.severity) {
        case ErrorSeverity.CRITICAL:
            logger.error('CRITICAL ERROR:', logData);
            break;
        case ErrorSeverity.HIGH:
            logger.error('HIGH SEVERITY ERROR:', logData);
            break;
        case ErrorSeverity.MEDIUM:
            logger.warn('MEDIUM SEVERITY ERROR:', logData);
            break;
        case ErrorSeverity.LOW:
            logger.info('LOW SEVERITY ERROR:', logData);
            break;
    }
};
exports.logError = logError;
// ========================================
// EXPRESS ERROR HANDLING MIDDLEWARE
// ========================================
const errorHandler = (error, req, res, next) => {
    const requestId = req.headers['x-request-id'];
    // If it's our custom error, handle it
    if (error instanceof AppError) {
        (0, exports.logError)(error, req, requestId);
        res.status(error.statusCode).json((0, exports.formatErrorResponse)(error, req, requestId));
        return;
    }
    // Handle validation errors from express-validator
    if (error.name === 'ValidationError') {
        const validationError = new ValidationError('Validation failed', { details: error.message });
        (0, exports.logError)(validationError, req, requestId);
        res.status(validationError.statusCode).json((0, exports.formatErrorResponse)(validationError, req, requestId));
        return;
    }
    // Handle JWT errors
    if (error.name === 'JsonWebTokenError') {
        const authError = new AuthenticationError('Invalid token');
        (0, exports.logError)(authError, req, requestId);
        res.status(authError.statusCode).json((0, exports.formatErrorResponse)(authError, req, requestId));
        return;
    }
    if (error.name === 'TokenExpiredError') {
        const authError = new AuthenticationError('Token expired');
        (0, exports.logError)(authError, req, requestId);
        res.status(authError.statusCode).json((0, exports.formatErrorResponse)(authError, req, requestId));
        return;
    }
    // Handle unknown errors
    const unknownError = new AppError('Internal server error', ErrorType.INTERNAL_SERVER_ERROR, 500, ErrorSeverity.CRITICAL, false, { originalError: error.message }, error);
    (0, exports.logError)(unknownError, req, requestId);
    res.status(500).json((0, exports.formatErrorResponse)(unknownError, req, requestId));
};
exports.errorHandler = errorHandler;
// ========================================
// ASYNC ERROR WRAPPER
// ========================================
const asyncHandler = (fn) => {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
};
exports.asyncHandler = asyncHandler;
// ========================================
// ERROR UTILITIES
// ========================================
const isOperationalError = (error) => {
    if (error instanceof AppError) {
        return error.isOperational;
    }
    return false;
};
exports.isOperationalError = isOperationalError;
const handleUncaughtExceptions = () => {
    process.on('uncaughtException', (error) => {
        logger.error('UNCAUGHT EXCEPTION:', {
            name: error.name,
            message: error.message,
            stack: error.stack
        });
        // Exit process with failure
        process.exit(1);
    });
};
exports.handleUncaughtExceptions = handleUncaughtExceptions;
const handleUnhandledRejections = () => {
    process.on('unhandledRejection', (reason, promise) => {
        logger.error('UNHANDLED REJECTION:', {
            reason,
            promise: promise.toString()
        });
        // Exit process with failure
        process.exit(1);
    });
};
exports.handleUnhandledRejections = handleUnhandledRejections;
// ========================================
// ERROR MAPPING
// ========================================
const mapHttpStatusToErrorType = (statusCode) => {
    switch (statusCode) {
        case 400: return ErrorType.VALIDATION_ERROR;
        case 401: return ErrorType.UNAUTHORIZED;
        case 403: return ErrorType.FORBIDDEN;
        case 404: return ErrorType.RESOURCE_NOT_FOUND;
        case 429: return ErrorType.RATE_LIMIT_EXCEEDED;
        case 500: return ErrorType.INTERNAL_SERVER_ERROR;
        case 502: return ErrorType.EXTERNAL_SERVICE_ERROR;
        case 503: return ErrorType.SERVICE_UNAVAILABLE;
        case 504: return ErrorType.TIMEOUT_ERROR;
        default: return ErrorType.INTERNAL_SERVER_ERROR;
    }
};
exports.mapHttpStatusToErrorType = mapHttpStatusToErrorType;
const mapErrorTypeToHttpStatus = (errorType) => {
    switch (errorType) {
        case ErrorType.VALIDATION_ERROR:
        case ErrorType.INVALID_INPUT:
        case ErrorType.MISSING_REQUIRED_FIELD:
            return 400;
        case ErrorType.UNAUTHORIZED:
        case ErrorType.INVALID_TOKEN:
        case ErrorType.TOKEN_EXPIRED:
            return 401;
        case ErrorType.FORBIDDEN:
        case ErrorType.INSUFFICIENT_PERMISSIONS:
            return 403;
        case ErrorType.RESOURCE_NOT_FOUND:
            return 404;
        case ErrorType.RESOURCE_ALREADY_EXISTS:
            return 409;
        case ErrorType.RATE_LIMIT_EXCEEDED:
        case ErrorType.TOO_MANY_REQUESTS:
            return 429;
        case ErrorType.EXTERNAL_SERVICE_ERROR:
        case ErrorType.AMAZON_API_ERROR:
        case ErrorType.GMAIL_API_ERROR:
        case ErrorType.STRIPE_API_ERROR:
            return 502;
        case ErrorType.SERVICE_UNAVAILABLE:
            return 503;
        case ErrorType.TIMEOUT_ERROR:
            return 504;
        default:
            return 500;
    }
};
exports.mapErrorTypeToHttpStatus = mapErrorTypeToHttpStatus;
//# sourceMappingURL=errorHandler.js.map