import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { 
  authenticateSSE, 
  verifySSEToken, 
  sendSSEEvent, 
  sendSSEHeartbeat, 
  closeSSEConnection,
  AuthenticatedSSERequest 
} from '../../src/middleware/sseAuthMiddleware';

// Mock JWT
jest.mock('jsonwebtoken', () => ({
  verify: jest.fn()
}));

// Mock config
jest.mock('../../src/config/env', () => ({
  JWT_SECRET: 'test-secret'
}));

// Mock logger
jest.mock('../../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}));

describe('SSE Authentication Middleware', () => {
  let mockRequest: AuthenticatedSSERequest;
  let mockResponse: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    jest.clearAllMocks();
    
    mockRequest = {
      headers: {},
      url: '/api/sse/test',
      method: 'GET',
      ip: '192.168.1.1',
      user: undefined
    } as AuthenticatedSSERequest;

    mockResponse = {
      writeHead: jest.fn(),
      write: jest.fn(),
      end: jest.fn()
    };

    mockNext = jest.fn();
  });

  describe('authenticateSSE', () => {
    it('should authenticate valid JWT token and set SSE headers', () => {
      const mockUser = { id: 'user-123', email: 'test@example.com' };
      (jwt.verify as jest.Mock).mockReturnValue(mockUser);

      mockRequest.headers.authorization = 'Bearer valid-token';

      authenticateSSE(mockRequest, mockResponse as Response, mockNext);

      expect(mockResponse.writeHead).toHaveBeenCalledWith(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Cache-Control'
      });

      expect(mockRequest.user).toEqual(mockUser);
      expect(mockResponse.write).toHaveBeenCalledWith(
        expect.stringContaining('event: auth_success')
      );
      expect(mockNext).toHaveBeenCalled();
    });

    it('should reject request without authorization header', () => {
      authenticateSSE(mockRequest, mockResponse as Response, mockNext);

      expect(mockResponse.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
      expect(mockResponse.write).toHaveBeenCalledWith(
        expect.stringContaining('event: error')
      );
      expect(mockResponse.write).toHaveBeenCalledWith(
        expect.stringContaining('AUTH_REQUIRED')
      );
      expect(mockResponse.end).toHaveBeenCalled();
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should reject request with invalid token format', () => {
      mockRequest.headers.authorization = 'InvalidFormat token';

      authenticateSSE(mockRequest, mockResponse as Response, mockNext);

      expect(mockResponse.write).toHaveBeenCalledWith(
        expect.stringContaining('event: error')
      );
      expect(mockResponse.write).toHaveBeenCalledWith(
        expect.stringContaining('AUTH_REQUIRED')
      );
      expect(mockResponse.end).toHaveBeenCalled();
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should reject request with invalid JWT token', () => {
      (jwt.verify as jest.Mock).mockImplementation(() => {
        throw new Error('Invalid token');
      });

      mockRequest.headers.authorization = 'Bearer invalid-token';

      authenticateSSE(mockRequest, mockResponse as Response, mockNext);

      expect(mockResponse.write).toHaveBeenCalledWith(
        expect.stringContaining('event: error')
      );
      expect(mockResponse.write).toHaveBeenCalledWith(
        expect.stringContaining('INVALID_TOKEN')
      );
      expect(mockResponse.end).toHaveBeenCalled();
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should handle expired JWT token', () => {
      (jwt.verify as jest.Mock).mockImplementation(() => {
        throw new Error('jwt expired');
      });

      mockRequest.headers.authorization = 'Bearer expired-token';

      authenticateSSE(mockRequest, mockResponse as Response, mockNext);

      expect(mockResponse.write).toHaveBeenCalledWith(
        expect.stringContaining('event: error')
      );
      expect(mockResponse.write).toHaveBeenCalledWith(
        expect.stringContaining('INVALID_TOKEN')
      );
      expect(mockResponse.end).toHaveBeenCalled();
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should handle middleware errors gracefully', () => {
      mockResponse.writeHead = jest.fn().mockImplementation(() => {
        throw new Error('Header error');
      });

      mockRequest.headers.authorization = 'Bearer valid-token';

      authenticateSSE(mockRequest, mockResponse as Response, mockNext);

      expect(mockResponse.write).toHaveBeenCalledWith(
        expect.stringContaining('event: error')
      );
      expect(mockResponse.write).toHaveBeenCalledWith(
        expect.stringContaining('INTERNAL_ERROR')
      );
      expect(mockResponse.end).toHaveBeenCalled();
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('verifySSEToken', () => {
    it('should verify and return decoded token', () => {
      const mockUser = { id: 'user-123', email: 'test@example.com' };
      (jwt.verify as jest.Mock).mockReturnValue(mockUser);

      const result = verifySSEToken('valid-token');

      expect(result).toEqual(mockUser);
      expect(jwt.verify).toHaveBeenCalledWith('valid-token', 'test-secret');
    });

    it('should throw error for invalid token', () => {
      (jwt.verify as jest.Mock).mockImplementation(() => {
        throw new Error('Invalid token');
      });

      expect(() => verifySSEToken('invalid-token')).toThrow('Invalid token');
    });
  });

  describe('sendSSEEvent', () => {
    it('should send SSE event with data', () => {
      const event = 'test_event';
      const data = { message: 'test message' };

      sendSSEEvent(mockResponse as Response, event, data);

      expect(mockResponse.write).toHaveBeenCalledWith(
        `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
      );
    });

    it('should send SSE event with id', () => {
      const event = 'test_event';
      const data = { message: 'test message' };
      const id = 'event-123';

      sendSSEEvent(mockResponse as Response, event, data, id);

      expect(mockResponse.write).toHaveBeenCalledWith(
        `event: ${event}\nid: ${id}\ndata: ${JSON.stringify(data)}\n\n`
      );
    });

    it('should handle write errors gracefully', () => {
      mockResponse.write = jest.fn().mockImplementation(() => {
        throw new Error('Write error');
      });

      const event = 'test_event';
      const data = { message: 'test message' };

      // Should not throw error
      expect(() => sendSSEEvent(mockResponse as Response, event, data)).not.toThrow();
    });
  });

  describe('sendSSEHeartbeat', () => {
    it('should send SSE heartbeat', () => {
      sendSSEHeartbeat(mockResponse as Response);

      expect(mockResponse.write).toHaveBeenCalledWith(
        expect.stringMatching(/^: heartbeat .*\n\n$/)
      );
    });

    it('should handle write errors gracefully', () => {
      mockResponse.write = jest.fn().mockImplementation(() => {
        throw new Error('Write error');
      });

      // Should not throw error
      expect(() => sendSSEHeartbeat(mockResponse as Response)).not.toThrow();
    });
  });

  describe('closeSSEConnection', () => {
    it('should close SSE connection gracefully', () => {
      closeSSEConnection(mockResponse as Response);

      expect(mockResponse.write).toHaveBeenCalledWith(
        expect.stringContaining('event: close')
      );
      expect(mockResponse.write).toHaveBeenCalledWith(
        expect.stringContaining('Connection closed')
      );
      expect(mockResponse.end).toHaveBeenCalled();
    });

    it('should handle write errors gracefully', () => {
      mockResponse.write = jest.fn().mockImplementation(() => {
        throw new Error('Write error');
      });

      // Should not throw error and still end connection
      expect(() => closeSSEConnection(mockResponse as Response)).not.toThrow();
      expect(mockResponse.end).toHaveBeenCalled();
    });
  });

  describe('Edge Cases', () => {
    it('should handle malformed authorization header', () => {
      mockRequest.headers.authorization = 'Bearer';

      authenticateSSE(mockRequest, mockResponse as Response, mockNext);

      expect(mockResponse.write).toHaveBeenCalledWith(
        expect.stringContaining('event: error')
      );
      expect(mockResponse.write).toHaveBeenCalledWith(
        expect.stringContaining('AUTH_REQUIRED')
      );
      expect(mockResponse.end).toHaveBeenCalled();
    });

    it('should handle empty authorization header', () => {
      mockRequest.headers.authorization = '';

      authenticateSSE(mockRequest, mockResponse as Response, mockNext);

      expect(mockResponse.write).toHaveBeenCalledWith(
        expect.stringContaining('event: error')
      );
      expect(mockResponse.write).toHaveBeenCalledWith(
        expect.stringContaining('AUTH_REQUIRED')
      );
      expect(mockResponse.end).toHaveBeenCalled();
    });

    it('should handle null authorization header', () => {
      mockRequest.headers.authorization = null as any;

      authenticateSSE(mockRequest, mockResponse as Response, mockNext);

      expect(mockResponse.write).toHaveBeenCalledWith(
        expect.stringContaining('event: error')
      );
      expect(mockResponse.write).toHaveBeenCalledWith(
        expect.stringContaining('AUTH_REQUIRED')
      );
      expect(mockResponse.end).toHaveBeenCalled();
    });
  });
});



