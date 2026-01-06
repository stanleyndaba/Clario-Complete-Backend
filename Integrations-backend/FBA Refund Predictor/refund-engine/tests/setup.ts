// Test setup file for Jest
import { jest } from '@jest/globals';

// Global test configuration
beforeAll(() => {
  // Set test environment
  process.env.NODE_ENV = 'test';
  
  // Mock console methods to reduce noise in tests
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterAll(() => {
  // Restore console methods
  jest.restoreAllMocks();
});

// Global test utilities
global.testUtils = {
  // Helper to create mock request objects
  createMockRequest: (data: any = {}) => ({
    body: data,
    params: {},
    query: {},
    user: { id: 'test-user', email: 'test@example.com' },
    ...data
  }),
  
  // Helper to create mock response objects
  createMockResponse: () => {
    const res: any = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    res.send = jest.fn().mockReturnValue(res);
    return res;
  },
  
  // Helper to create mock next function
  createMockNext: () => jest.fn(),
  
  // Helper to wait for async operations
  wait: (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
};

// Type declarations for global test utilities
declare global {
  namespace NodeJS {
    interface Global {
      testUtils: {
        createMockRequest: (data?: any) => any;
        createMockResponse: () => any;
        createMockNext: () => jest.Mock;
        wait: (ms: number) => Promise<void>;
      };
    }
  }
} 