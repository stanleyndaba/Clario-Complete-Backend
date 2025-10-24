import { Request, Response, NextFunction } from 'express';
import { RedisClientType } from 'redis';
import { 
  rateLimit, 
  createRateLimit, 
  createUserRateLimit, 
  createIPRateLimit,
  getRateLimitStatus 
} from '../../src/middleware/rateLimit';

// Mock Redis client
const mockRedisClient = {
  multi: jest.fn(),
  incr: jest.fn(),
  expire: jest.fn(),
  get: jest.fn(),
  ttl: jest.fn(),
  isReady: true,
  connect: jest.fn(),
  quit: jest.fn(),
  on: jest.fn()
} as any;

// Mock logger
jest.mock('../../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
}));

describe('Rate Limit Middleware', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockNext: NextFunction;
  let mockPipeline: any;

  beforeEach(() => {
    jest.clearAllMocks();
    
    mockRequest = {
      ip: '192.168.1.1',
      connection: { remoteAddress: '192.168.1.1' } as any,
      get: jest.fn().mockReturnValue('test-user-agent'),
      user: { id: 'test-user-123' }
    } as any;

    mockResponse = {
      set: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };

    mockNext = jest.fn();

    // Mock Redis pipeline
    mockPipeline = {
      incr: jest.fn().mockReturnThis(),
      expire: jest.fn().mockReturnThis(),
      exec: jest.fn()
    };
    mockRedisClient.multi.mockReturnValue(mockPipeline);
  });

  describe('rateLimit', () => {
    const options = {
      keyPrefix: 'test',
      windowSec: 60,
      maxHits: 5,
      redisClient: mockRedisClient
    };

    it('should allow request within rate limit', async () => {
      mockPipeline.exec.mockResolvedValue([3, 1]); // currentHits: 3, expirySet: 1

      const middleware = rateLimit(options);
      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockResponse.set).toHaveBeenCalledWith({
        'X-RateLimit-Limit': '5',
        'X-RateLimit-Remaining': '2',
        'X-RateLimit-Reset': expect.any(String)
      });
      expect(mockPipeline.incr).toHaveBeenCalledWith('rate_limit:test:test-user-123:192.168.1.1');
      expect(mockPipeline.expire).toHaveBeenCalledWith('rate_limit:test:test-user-123:192.168.1.1', 60);
    });

    it('should block request when rate limit exceeded', async () => {
      mockPipeline.exec.mockResolvedValue([6, 1]); // currentHits: 6, expirySet: 1

      const middleware = rateLimit(options);
      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockResponse.status).toHaveBeenCalledWith(429);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Too many requests',
        retryAfter: 60,
        limit: 5,
        remaining: 0
      });
      expect(mockResponse.set).toHaveBeenCalledWith('Retry-After', '60');
    });

    it('should handle Redis pipeline failure gracefully', async () => {
      mockPipeline.exec.mockResolvedValue(null);

      const middleware = rateLimit(options);
      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalled(); // Fail open
    });

    it('should handle Redis error gracefully', async () => {
      mockPipeline.exec.mockRejectedValue(new Error('Redis error'));

      const middleware = rateLimit(options);
      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalled(); // Fail open
    });

    it('should handle missing pipeline results', async () => {
      mockPipeline.exec.mockResolvedValue([3]); // Only one result

      const middleware = rateLimit(options);
      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalled(); // Fail open
    });

    it('should use custom key generator when provided', async () => {
      const customOptions = {
        ...options,
        getKey: (req: Request) => `custom:${req.ip}`
      };

      mockPipeline.exec.mockResolvedValue([1, 1]);

      const middleware = rateLimit(customOptions);
      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockPipeline.incr).toHaveBeenCalledWith('rate_limit:custom:192.168.1.1');
    });

    it('should handle requests without user ID', async () => {
      const requestWithoutUser = { ...mockRequest, user: undefined };
      mockPipeline.exec.mockResolvedValue([1, 1]);

      const middleware = rateLimit(options);
      await middleware(requestWithoutUser as Request, mockResponse as Response, mockNext);

      expect(mockPipeline.incr).toHaveBeenCalledWith('rate_limit:test:anonymous:192.168.1.1');
    });

    it('should handle requests without IP', async () => {
      const requestWithoutIP = { ...mockRequest, ip: undefined, connection: { remoteAddress: undefined } as any } as any;
      mockPipeline.exec.mockResolvedValue([1, 1]);

      const middleware = rateLimit(options);
      await middleware(requestWithoutIP as Request, mockResponse as Response, mockNext);

      expect(mockPipeline.incr).toHaveBeenCalledWith('rate_limit:test:test-user-123:unknown');
    });
  });

  describe('createRateLimit', () => {
    it('should create rate limit middleware with default key generation', () => {
      const middleware = createRateLimit(mockRedisClient, 'test', 60, 5);
      
      expect(typeof middleware).toBe('function');
    });

    it('should use correct parameters', async () => {
      mockPipeline.exec.mockResolvedValue([1, 1]);

      const middleware = createRateLimit(mockRedisClient, 'api', 120, 10);
      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockPipeline.incr).toHaveBeenCalledWith('rate_limit:api:test-user-123:192.168.1.1');
      expect(mockPipeline.expire).toHaveBeenCalledWith('rate_limit:api:test-user-123:192.168.1.1', 120);
    });
  });

  describe('createUserRateLimit', () => {
    it('should create rate limit middleware for authenticated users', () => {
      const middleware = createUserRateLimit(mockRedisClient, 'user', 60, 5);
      
      expect(typeof middleware).toBe('function');
    });

    it('should use user ID for key generation', async () => {
      mockPipeline.exec.mockResolvedValue([1, 1]);

      const middleware = createUserRateLimit(mockRedisClient, 'user', 60, 5);
      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockPipeline.incr).toHaveBeenCalledWith('rate_limit:user:test-user-123');
    });

    it('should throw error for unauthenticated requests', async () => {
      const requestWithoutUser = { ...mockRequest, user: undefined };
      mockPipeline.exec.mockResolvedValue([1, 1]);

      const middleware = createUserRateLimit(mockRedisClient, 'user', 60, 5);
      
      await expect(
        middleware(requestWithoutUser as Request, mockResponse as Response, mockNext)
      ).rejects.toThrow('User authentication required for rate limiting');
    });
  });

  describe('createIPRateLimit', () => {
    it('should create rate limit middleware for IP-based limiting', () => {
      const middleware = createIPRateLimit(mockRedisClient, 'ip', 60, 5);
      
      expect(typeof middleware).toBe('function');
    });

    it('should use IP address for key generation', async () => {
      mockPipeline.exec.mockResolvedValue([1, 1]);

      const middleware = createIPRateLimit(mockRedisClient, 'ip', 60, 5);
      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockPipeline.incr).toHaveBeenCalledWith('rate_limit:ip:192.168.1.1');
    });

    it('should handle missing IP gracefully', async () => {
      const requestWithoutIP = { ...mockRequest, ip: undefined, connection: { remoteAddress: undefined } };
      mockPipeline.exec.mockResolvedValue([1, 1]);

      const middleware = createIPRateLimit(mockRedisClient, 'ip', 60, 5);
      await middleware(requestWithoutIP as Request, mockResponse as Response, mockNext);

      expect(mockPipeline.incr).toHaveBeenCalledWith('rate_limit:ip:unknown');
    });
  });

  describe('getRateLimitStatus', () => {
    it('should return rate limit status for existing key', async () => {
      mockRedisClient.get.mockResolvedValue('3');
      mockRedisClient.ttl.mockResolvedValue(45);

      const status = await getRateLimitStatus(mockRedisClient, 'test:user:ip');

      expect(status).toEqual({
        limit: 0,
        remaining: -3,
        reset: expect.any(Number)
      });
    });

    it('should return null for non-existent key', async () => {
      mockRedisClient.get.mockResolvedValue(null);

      const status = await getRateLimitStatus(mockRedisClient, 'test:user:ip');

      expect(status).toBeNull();
    });

    it('should handle Redis errors gracefully', async () => {
      mockRedisClient.get.mockRejectedValue(new Error('Redis error'));

      const status = await getRateLimitStatus(mockRedisClient, 'test:user:ip');

      expect(status).toBeNull();
    });

    it('should handle invalid hit count', async () => {
      mockRedisClient.get.mockResolvedValue('invalid');
      mockRedisClient.ttl.mockResolvedValue(45);

      const status = await getRateLimitStatus(mockRedisClient, 'test:user:ip');

      expect(status).toEqual({
        limit: 0,
        remaining: 0,
        reset: expect.any(Number)
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle rapid requests beyond max hits', async () => {
      const middleware = rateLimit(options);
      
      // Simulate rapid requests
      for (let i = 0; i < 10; i++) {
        mockPipeline.exec.mockResolvedValue([i + 1, 1]);
        
        await middleware(mockRequest as Request, mockResponse as Response, mockNext);
        
        if (i < 4) {
          expect(mockNext).toHaveBeenCalledTimes(i + 1);
        } else {
          expect(mockResponse.status).toHaveBeenCalledWith(429);
        }
      }
    });

    it('should handle concurrent requests', async () => {
      mockPipeline.exec.mockResolvedValue([1, 1]);

      const middleware = rateLimit(options);
      const promises = [];

      // Simulate concurrent requests
      for (let i = 0; i < 5; i++) {
        promises.push(
          middleware(mockRequest as Request, mockResponse as Response, mockNext)
        );
      }

      await Promise.all(promises);

      expect(mockPipeline.incr).toHaveBeenCalledTimes(5);
    });

    it('should handle malformed Redis responses', async () => {
      mockPipeline.exec.mockResolvedValue(['invalid', 'invalid']);

      const middleware = rateLimit(options);
      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalled(); // Fail open
    });

    it('should handle negative hit counts', async () => {
      mockPipeline.exec.mockResolvedValue([-1, 1]);

      const middleware = rateLimit(options);
      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockResponse.set).toHaveBeenCalledWith({
        'X-RateLimit-Limit': '5',
        'X-RateLimit-Remaining': '6', // 5 - (-1) = 6
        'X-RateLimit-Reset': expect.any(String)
      });
    });

    it('should handle very large hit counts', async () => {
      mockPipeline.exec.mockResolvedValue([1000000, 1]);

      const middleware = rateLimit(options);
      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(429);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Too many requests',
        retryAfter: 60,
        limit: 5,
        remaining: 0
      });
    });

    it('should handle zero window seconds', async () => {
      const zeroWindowOptions = { ...options, windowSec: 0 };
      mockPipeline.exec.mockResolvedValue([1, 1]);

      const middleware = rateLimit(zeroWindowOptions);
      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockPipeline.expire).toHaveBeenCalledWith('rate_limit:test:test-user-123:192.168.1.1', 0);
    });

    it('should handle zero max hits', async () => {
      const zeroMaxOptions = { ...options, maxHits: 0 };
      mockPipeline.exec.mockResolvedValue([1, 1]);

      const middleware = rateLimit(zeroMaxOptions);
      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(429);
    });
  });

  describe('Header Validation', () => {
    it('should set correct rate limit headers', async () => {
      mockPipeline.exec.mockResolvedValue([2, 1]);

      const middleware = rateLimit(options);
      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.set).toHaveBeenCalledWith({
        'X-RateLimit-Limit': '5',
        'X-RateLimit-Remaining': '3',
        'X-RateLimit-Reset': expect.any(String)
      });
    });

    it('should set Retry-After header when limit exceeded', async () => {
      mockPipeline.exec.mockResolvedValue([6, 1]);

      const middleware = rateLimit(options);
      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.set).toHaveBeenCalledWith('Retry-After', '60');
    });

    it('should calculate correct reset time', async () => {
      const startTime = Date.now();
      mockPipeline.exec.mockResolvedValue([1, 1]);

      const middleware = rateLimit(options);
      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      const setCall = (mockResponse.set as jest.Mock).mock.calls[0][0];
      const resetTime = parseInt(setCall['X-RateLimit-Reset']);
      
      expect(resetTime).toBeGreaterThanOrEqual(Math.floor(startTime / 1000) + 60);
      expect(resetTime).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + 60);
    });
  });
});
