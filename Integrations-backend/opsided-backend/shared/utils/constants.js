"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SUCCESS_MESSAGES = exports.ERROR_MESSAGES = exports.LOCATION_ONLINE = exports.LOCATION_STORE = exports.LOCATION_WAREHOUSE = exports.ROLE_VIEWER = exports.ROLE_USER = exports.ROLE_ADMIN = exports.SOURCE_SYNC = exports.SOURCE_MANUAL = exports.SOURCE_STRIPE = exports.SOURCE_AMAZON = exports.STATUS_PROCESSING = exports.STATUS_REJECTED = exports.STATUS_APPROVED = exports.STATUS_PENDING = exports.DEFAULT_LIMIT = exports.DEFAULT_OFFSET = exports.ALLOWED_FILE_TYPES = exports.MAX_FILE_SIZE = exports.RATE_LIMIT_MAX_REQUESTS = exports.RATE_LIMIT_WINDOW_MS = exports.JWT_REFRESH_EXPIRES_IN = exports.JWT_EXPIRES_IN = exports.MAX_PAGE_SIZE = exports.DEFAULT_PAGE_SIZE = exports.API_VERSION = exports.DB_NAME = exports.DB_SCHEMA_VERSION = exports.APP_VERSION = exports.APP_NAME = void 0;
// Application constants
exports.APP_NAME = 'Opsided Backend';
exports.APP_VERSION = '1.0.0';
// Database constants
exports.DB_SCHEMA_VERSION = '1.0.0';
exports.DB_NAME = 'opsided_db';
// API constants
exports.API_VERSION = 'v1';
exports.DEFAULT_PAGE_SIZE = 20;
exports.MAX_PAGE_SIZE = 100;
// JWT constants
exports.JWT_EXPIRES_IN = '24h';
exports.JWT_REFRESH_EXPIRES_IN = '7d';
// Rate limiting
exports.RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
exports.RATE_LIMIT_MAX_REQUESTS = 100;
// File upload limits
exports.MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
exports.ALLOWED_FILE_TYPES = ['image/jpeg', 'image/png', 'application/pdf'];
// Pagination
exports.DEFAULT_OFFSET = 0;
exports.DEFAULT_LIMIT = 20;
// Status codes
exports.STATUS_PENDING = 'pending';
exports.STATUS_APPROVED = 'approved';
exports.STATUS_REJECTED = 'rejected';
exports.STATUS_PROCESSING = 'processing';
// Sources
exports.SOURCE_AMAZON = 'amazon';
exports.SOURCE_STRIPE = 'stripe';
exports.SOURCE_MANUAL = 'manual';
exports.SOURCE_SYNC = 'sync';
// User roles
exports.ROLE_ADMIN = 'admin';
exports.ROLE_USER = 'user';
exports.ROLE_VIEWER = 'viewer';
// Inventory locations
exports.LOCATION_WAREHOUSE = 'warehouse';
exports.LOCATION_STORE = 'store';
exports.LOCATION_ONLINE = 'online';
// Error messages
exports.ERROR_MESSAGES = {
    UNAUTHORIZED: 'Unauthorized access',
    FORBIDDEN: 'Access forbidden',
    NOT_FOUND: 'Resource not found',
    VALIDATION_ERROR: 'Validation error',
    INTERNAL_ERROR: 'Internal server error',
    DATABASE_ERROR: 'Database error',
    ENCRYPTION_ERROR: 'Encryption error',
};
// Success messages
exports.SUCCESS_MESSAGES = {
    CREATED: 'Resource created successfully',
    UPDATED: 'Resource updated successfully',
    DELETED: 'Resource deleted successfully',
    SYNCED: 'Data synced successfully',
};
//# sourceMappingURL=constants.js.map