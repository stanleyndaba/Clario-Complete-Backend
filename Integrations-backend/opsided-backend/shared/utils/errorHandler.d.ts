import { Request, Response, NextFunction } from 'express';
export declare enum ErrorType {
    UNAUTHORIZED = "UNAUTHORIZED",
    FORBIDDEN = "FORBIDDEN",
    INVALID_TOKEN = "INVALID_TOKEN",
    TOKEN_EXPIRED = "TOKEN_EXPIRED",
    VALIDATION_ERROR = "VALIDATION_ERROR",
    INVALID_INPUT = "INVALID_INPUT",
    MISSING_REQUIRED_FIELD = "MISSING_REQUIRED_FIELD",
    BUSINESS_RULE_VIOLATION = "BUSINESS_RULE_VIOLATION",
    INSUFFICIENT_PERMISSIONS = "INSUFFICIENT_PERMISSIONS",
    RESOURCE_NOT_FOUND = "RESOURCE_NOT_FOUND",
    RESOURCE_ALREADY_EXISTS = "RESOURCE_ALREADY_EXISTS",
    EXTERNAL_SERVICE_ERROR = "EXTERNAL_SERVICE_ERROR",
    AMAZON_API_ERROR = "AMAZON_API_ERROR",
    GMAIL_API_ERROR = "GMAIL_API_ERROR",
    STRIPE_API_ERROR = "STRIPE_API_ERROR",
    DATABASE_ERROR = "DATABASE_ERROR",
    CONNECTION_ERROR = "CONNECTION_ERROR",
    QUERY_ERROR = "QUERY_ERROR",
    RATE_LIMIT_EXCEEDED = "RATE_LIMIT_EXCEEDED",
    TOO_MANY_REQUESTS = "TOO_MANY_REQUESTS",
    INTERNAL_SERVER_ERROR = "INTERNAL_SERVER_ERROR",
    SERVICE_UNAVAILABLE = "SERVICE_UNAVAILABLE",
    TIMEOUT_ERROR = "TIMEOUT_ERROR",
    SYNC_ERROR = "SYNC_ERROR",
    OAUTH_ERROR = "OAUTH_ERROR",
    WEBHOOK_ERROR = "WEBHOOK_ERROR",
    ENCRYPTION_ERROR = "ENCRYPTION_ERROR"
}
export declare enum ErrorSeverity {
    LOW = "low",
    MEDIUM = "medium",
    HIGH = "high",
    CRITICAL = "critical"
}
export declare class AppError extends Error {
    readonly type: ErrorType;
    readonly statusCode: number;
    readonly severity: ErrorSeverity;
    readonly isOperational: boolean;
    readonly context?: Record<string, any>;
    readonly originalError?: Error;
    constructor(message: string, type: ErrorType, statusCode?: number, severity?: ErrorSeverity, isOperational?: boolean, context?: Record<string, any>, originalError?: Error);
}
export declare class ValidationError extends AppError {
    constructor(message: string, context?: Record<string, any>);
}
export declare class AuthenticationError extends AppError {
    constructor(message?: string, context?: Record<string, any>);
}
export declare class AuthorizationError extends AppError {
    constructor(message?: string, context?: Record<string, any>);
}
export declare class NotFoundError extends AppError {
    constructor(resource: string, context?: Record<string, any>);
}
export declare class ExternalServiceError extends AppError {
    constructor(service: string, message: string, statusCode?: number, context?: Record<string, any>);
}
export declare class SyncError extends AppError {
    constructor(provider: string, message: string, context?: Record<string, any>);
}
export interface ErrorResponse {
    success: false;
    error: {
        type: string;
        message: string;
        statusCode: number;
        severity: string;
        timestamp: string;
        requestId?: string;
        path?: string;
        method?: string;
        context?: Record<string, any>;
    };
}
export declare const formatErrorResponse: (error: AppError, req?: Request, requestId?: string) => ErrorResponse;
export declare const logError: (error: AppError, req?: Request, requestId?: string) => void;
export declare const errorHandler: (error: Error, req: Request, res: Response, next: NextFunction) => void;
export declare const asyncHandler: <T extends Request, U extends Response>(fn: (req: T, res: U, next: NextFunction) => Promise<any>) => (req: T, res: U, next: NextFunction) => void;
export declare const isOperationalError: (error: Error) => boolean;
export declare const handleUncaughtExceptions: () => void;
export declare const handleUnhandledRejections: () => void;
export declare const mapHttpStatusToErrorType: (statusCode: number) => ErrorType;
export declare const mapErrorTypeToHttpStatus: (errorType: ErrorType) => number;
export declare enum ErrorType {
    UNAUTHORIZED = "UNAUTHORIZED",
    FORBIDDEN = "FORBIDDEN",
    INVALID_TOKEN = "INVALID_TOKEN",
    TOKEN_EXPIRED = "TOKEN_EXPIRED",
    VALIDATION_ERROR = "VALIDATION_ERROR",
    INVALID_INPUT = "INVALID_INPUT",
    MISSING_REQUIRED_FIELD = "MISSING_REQUIRED_FIELD",
    BUSINESS_RULE_VIOLATION = "BUSINESS_RULE_VIOLATION",
    INSUFFICIENT_PERMISSIONS = "INSUFFICIENT_PERMISSIONS",
    RESOURCE_NOT_FOUND = "RESOURCE_NOT_FOUND",
    RESOURCE_ALREADY_EXISTS = "RESOURCE_ALREADY_EXISTS",
    EXTERNAL_SERVICE_ERROR = "EXTERNAL_SERVICE_ERROR",
    AMAZON_API_ERROR = "AMAZON_API_ERROR",
    GMAIL_API_ERROR = "GMAIL_API_ERROR",
    STRIPE_API_ERROR = "STRIPE_API_ERROR",
    DATABASE_ERROR = "DATABASE_ERROR",
    CONNECTION_ERROR = "CONNECTION_ERROR",
    QUERY_ERROR = "QUERY_ERROR",
    RATE_LIMIT_EXCEEDED = "RATE_LIMIT_EXCEEDED",
    TOO_MANY_REQUESTS = "TOO_MANY_REQUESTS",
    INTERNAL_SERVER_ERROR = "INTERNAL_SERVER_ERROR",
    SERVICE_UNAVAILABLE = "SERVICE_UNAVAILABLE",
    TIMEOUT_ERROR = "TIMEOUT_ERROR",
    SYNC_ERROR = "SYNC_ERROR",
    OAUTH_ERROR = "OAUTH_ERROR",
    WEBHOOK_ERROR = "WEBHOOK_ERROR",
    ENCRYPTION_ERROR = "ENCRYPTION_ERROR"
}
export declare enum ErrorSeverity {
    LOW = "low",
    MEDIUM = "medium",
    HIGH = "high",
    CRITICAL = "critical"
}
export declare class AppError extends Error {
    readonly type: ErrorType;
    readonly statusCode: number;
    readonly severity: ErrorSeverity;
    readonly isOperational: boolean;
    readonly context?: Record<string, any>;
    readonly originalError?: Error;
    constructor(message: string, type: ErrorType, statusCode?: number, severity?: ErrorSeverity, isOperational?: boolean, context?: Record<string, any>, originalError?: Error);
}
export declare class ValidationError extends AppError {
    constructor(message: string, context?: Record<string, any>);
}
export declare class AuthenticationError extends AppError {
    constructor(message?: string, context?: Record<string, any>);
}
export declare class AuthorizationError extends AppError {
    constructor(message?: string, context?: Record<string, any>);
}
export declare class NotFoundError extends AppError {
    constructor(resource: string, context?: Record<string, any>);
}
export declare class ExternalServiceError extends AppError {
    constructor(service: string, message: string, statusCode?: number, context?: Record<string, any>);
}
export declare class SyncError extends AppError {
    constructor(provider: string, message: string, context?: Record<string, any>);
}
export interface ErrorResponse {
    success: false;
    error: {
        type: string;
        message: string;
        statusCode: number;
        severity: string;
        timestamp: string;
        requestId?: string;
        path?: string;
        method?: string;
        context?: Record<string, any>;
    };
}
export declare const formatErrorResponse: (error: AppError, req?: Request, requestId?: string) => ErrorResponse;
export declare const logError: (error: AppError, req?: Request, requestId?: string) => void;
export declare const errorHandler: (error: Error, req: Request, res: Response, next: NextFunction) => void;
export declare const asyncHandler: <T extends Request, U extends Response>(fn: (req: T, res: U, next: NextFunction) => Promise<any>) => (req: T, res: U, next: NextFunction) => void;
export declare const isOperationalError: (error: Error) => boolean;
export declare const handleUncaughtExceptions: () => void;
export declare const handleUnhandledRejections: () => void;
export declare const mapHttpStatusToErrorType: (statusCode: number) => ErrorType;
export declare const mapErrorTypeToHttpStatus: (errorType: ErrorType) => number;
//# sourceMappingURL=errorHandler.d.ts.map