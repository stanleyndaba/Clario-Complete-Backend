// Test setup file
import { beforeAll, afterAll } from '@jest/globals';
import dotenv from 'dotenv';

// Load environment variables for testing
dotenv.config({ path: '.env.test' });

// Mock environment variables for testing
process.env['NODE_ENV'] = 'test';
process.env['PORT'] = '3001';
process.env['SUPABASE_URL'] = 'https://test.supabase.co';
process.env['SUPABASE_ANON_KEY'] = 'test-anon-key';
process.env['JWT_SECRET'] = 'test-jwt-secret';
process.env['ENCRYPTION_KEY'] = 'test-encryption-key-32-chars-long';
process.env['TOKEN_ENCRYPTION_KEY'] = 'test-token-encryption-key-32-chars';
process.env['REDIS_URL'] = 'redis://localhost:6379';

// Global test setup
beforeAll(() => {
  // Setup any global test configuration
});

afterAll(() => {
  // Cleanup any global test configuration
}); 