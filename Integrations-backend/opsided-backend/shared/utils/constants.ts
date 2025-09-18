// Application constants
export const APP_NAME = 'Opsided Backend';
export const APP_VERSION = '1.0.0';

// Database constants
export const DB_SCHEMA_VERSION = '1.0.0';
export const DB_NAME = 'opsided_db';

// API constants
export const API_VERSION = 'v1';
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

// JWT constants
export const JWT_EXPIRES_IN = '24h';
export const JWT_REFRESH_EXPIRES_IN = '7d';

// Rate limiting
export const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
export const RATE_LIMIT_MAX_REQUESTS = 100;

// File upload limits
export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
export const ALLOWED_FILE_TYPES = ['image/jpeg', 'image/png', 'application/pdf'];

// Pagination
export const DEFAULT_OFFSET = 0;
export const DEFAULT_LIMIT = 20;

// Status codes
export const STATUS_PENDING = 'pending';
export const STATUS_APPROVED = 'approved';
export const STATUS_REJECTED = 'rejected';
export const STATUS_PROCESSING = 'processing';

// Sources
export const SOURCE_AMAZON = 'amazon';
export const SOURCE_STRIPE = 'stripe';
export const SOURCE_MANUAL = 'manual';
export const SOURCE_SYNC = 'sync';

// User roles
export const ROLE_ADMIN = 'admin';
export const ROLE_USER = 'user';
export const ROLE_VIEWER = 'viewer';

// Inventory locations
export const LOCATION_WAREHOUSE = 'warehouse';
export const LOCATION_STORE = 'store';
export const LOCATION_ONLINE = 'online';

// Error messages
export const ERROR_MESSAGES = {
  UNAUTHORIZED: 'Unauthorized access',
  FORBIDDEN: 'Access forbidden',
  NOT_FOUND: 'Resource not found',
  VALIDATION_ERROR: 'Validation error',
  INTERNAL_ERROR: 'Internal server error',
  DATABASE_ERROR: 'Database error',
  ENCRYPTION_ERROR: 'Encryption error',
} as const;

// Success messages
export const SUCCESS_MESSAGES = {
  CREATED: 'Resource created successfully',
  UPDATED: 'Resource updated successfully',
  DELETED: 'Resource deleted successfully',
  SYNCED: 'Data synced successfully',
} as const; 