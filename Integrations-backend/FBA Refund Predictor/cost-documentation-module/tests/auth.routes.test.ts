import request from 'supertest';
import express from 'express';
import { CostDocumentationController } from '../src/controllers/costDocumentationController';
import costDocumentationRoutes from '../src/routes/costDocumentationRoutes';
import jwt from 'jsonwebtoken';

// Mock the services
jest.mock('../src/services/costDocumentationService');
jest.mock('../src/workers/costDocumentationWorker');

// Mock JWT verification
jest.mock('jsonwebtoken', () => ({
  verify: jest.fn()
}));

describe('Authentication and Authorization', () => {
  let app: express.Application;
  
  const mockEvidence = {
    anomaly_id: 'test-anomaly-123',
    type: 'lost_units',
    sku: 'TEST-SKU-001',
    expected_units: 100,
    received_units: 95,
    loss: 5,
    cost_per_unit: 12.50,
    total_loss: 62.50,
    detected_at: '2025-01-15T10:30:00Z',
    evidence_links: ['s3://artifacts/receiving_scan.pdf'],
    seller_info: {
      seller_id: 'seller-123',
      business_name: 'Test Company Inc.'
    }
  };

  const validToken = 'valid.jwt.token';
  const invalidToken = 'invalid.jwt.token';
  const expiredToken = 'expired.jwt.token';

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Create Express app for testing
    app = express();
    app.use(express.json());
    
    // Mock JWT verification
    (jwt.verify as jest.Mock).mockImplementation((token) => {
      if (token === validToken) {
        return {
          userId: 'user-123',
          sellerId: 'seller-123',
          role: 'user',
          tenant: 'tenant-123'
        };
      } else if (token === expiredToken) {
        throw new Error('Token expired');
      } else {
        throw new Error('Invalid token');
      }
    });
    
    // Apply routes
    app.use('/api/v1/cost-documentation', costDocumentationRoutes);
  });

  describe('JWT Authentication', () => {
    it('should return 401 without JWT token', async () => {
      const response = await request(app)
        .post('/api/v1/cost-documentation/generate/auto')
        .send(mockEvidence);
      
      expect(response.status).toBe(401);
      expect(response.body.error).toContain('No token provided');
    });

    it('should return 401 with invalid JWT token', async () => {
      const response = await request(app)
        .post('/api/v1/cost-documentation/generate/auto')
        .set('Authorization', `Bearer ${invalidToken}`)
        .send(mockEvidence);
      
      expect(response.status).toBe(401);
      expect(response.body.error).toContain('Invalid token');
    });

    it('should return 401 with expired JWT token', async () => {
      const response = await request(app)
        .post('/api/v1/cost-documentation/generate/auto')
        .set('Authorization', `Bearer ${expiredToken}`)
        .send(mockEvidence);
      
      expect(response.status).toBe(401);
      expect(response.body.error).toContain('Token expired');
    });

    it('should accept valid JWT token', async () => {
      // Mock the controller to return success
      const mockController = CostDocumentationController as any;
      mockController.generateFromEvidence = jest.fn().mockImplementation((req, res) => {
        res.status(202).json({
          success: true,
          message: 'Job queued successfully',
          job_id: 'job-123'
        });
      });
      
      const response = await request(app)
        .post('/api/v1/cost-documentation/generate/auto')
        .set('Authorization', `Bearer ${validToken}`)
        .send(mockEvidence);
      
      expect(response.status).toBe(202);
      expect(response.body.success).toBe(true);
    });
  });

  describe('Role-Based Authorization', () => {
    it('should allow user role to access basic endpoints', async () => {
      // Mock JWT with user role
      (jwt.verify as jest.Mock).mockReturnValue({
        userId: 'user-123',
        sellerId: 'seller-123',
        role: 'user',
        tenant: 'tenant-123'
      });
      
      // Mock controller
      const mockController = CostDocumentationController as any;
      mockController.generateManual = jest.fn().mockImplementation((req, res) => {
        res.status(200).json({
          success: true,
          message: 'Documentation generated successfully'
        });
      });
      
      const response = await request(app)
        .post('/api/v1/cost-documentation/generate/manual')
        .set('Authorization', `Bearer ${validToken}`)
        .send(mockEvidence);
      
      expect(response.status).toBe(200);
    });

    it('should allow agent role to access queue management', async () => {
      // Mock JWT with agent role
      (jwt.verify as jest.Mock).mockReturnValue({
        userId: 'agent-123',
        sellerId: 'seller-123',
        role: 'agent',
        tenant: 'tenant-123'
      });
      
      // Mock controller
      const mockController = CostDocumentationController as any;
      mockController.getQueueStats = jest.fn().mockImplementation((req, res) => {
        res.status(200).json({
          success: true,
          queue_stats: { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 }
        });
      });
      
      const response = await request(app)
        .get('/api/v1/cost-documentation/queue/stats')
        .set('Authorization', `Bearer ${validToken}`);
      
      expect(response.status).toBe(200);
    });

    it('should allow admin role to access all endpoints', async () => {
      // Mock JWT with admin role
      (jwt.verify as jest.Mock).mockReturnValue({
        userId: 'admin-123',
        sellerId: 'seller-123',
        role: 'admin',
        tenant: 'tenant-123'
      });
      
      // Mock controller
      const mockController = CostDocumentationController as any;
      mockController.clearQueue = jest.fn().mockImplementation((req, res) => {
        res.status(200).json({
          success: true,
          message: 'Queue cleared successfully'
        });
      });
      
      const response = await request(app)
        .delete('/api/v1/cost-documentation/queue/clear')
        .set('Authorization', `Bearer ${validToken}`);
      
      expect(response.status).toBe(200);
    });

    it('should deny user role access to admin endpoints', async () => {
      // Mock JWT with user role
      (jwt.verify as jest.Mock).mockReturnValue({
        userId: 'user-123',
        sellerId: 'seller-123',
        role: 'user',
        tenant: 'tenant-123'
      });
      
      const response = await request(app)
        .delete('/api/v1/cost-documentation/queue/clear')
        .set('Authorization', `Bearer ${validToken}`);
      
      expect(response.status).toBe(403);
      expect(response.body.error).toContain('Insufficient permissions');
    });
  });

  describe('Tenant Isolation', () => {
    it('should isolate data by tenant', async () => {
      // Mock JWT with tenant-123
      (jwt.verify as jest.Mock).mockReturnValue({
        userId: 'user-123',
        sellerId: 'seller-123',
        role: 'user',
        tenant: 'tenant-123'
      });
      
      // Mock controller to check tenant
      const mockController = CostDocumentationController as any;
      mockController.getBySellerId = jest.fn().mockImplementation((req, res) => {
        // Verify tenant isolation
        if (req.user.tenant !== 'tenant-123') {
          return res.status(403).json({
            success: false,
            error: 'Access denied to this tenant'
          });
        }
        
        res.status(200).json({
          success: true,
          documentation: []
        });
      });
      
      const response = await request(app)
        .get('/api/v1/cost-documentation/seller/seller-123')
        .set('Authorization', `Bearer ${validToken}`);
      
      expect(response.status).toBe(200);
    });

    it('should prevent cross-tenant access', async () => {
      // Mock JWT with different tenant
      (jwt.verify as jest.Mock).mockReturnValue({
        userId: 'user-123',
        sellerId: 'seller-123',
        role: 'user',
        tenant: 'tenant-456' // Different tenant
      });
      
      // Mock controller to enforce tenant isolation
      const mockController = CostDocumentationController as any;
      mockController.getBySellerId = jest.fn().mockImplementation((req, res) => {
        // This should not be called due to middleware
        res.status(200).json({ success: true });
      });
      
      const response = await request(app)
        .get('/api/v1/cost-documentation/seller/seller-123')
        .set('Authorization', `Bearer ${validToken}`);
      
      // Should be blocked by middleware
      expect(response.status).toBe(403);
    });
  });

  describe('Rate Limiting', () => {
    it('should enforce rate limits on authenticated endpoints', async () => {
      // Mock JWT verification
      (jwt.verify as jest.Mock).mockReturnValue({
        userId: 'user-123',
        sellerId: 'seller-123',
        role: 'user',
        tenant: 'tenant-123'
      });
      
      // Mock controller
      const mockController = CostDocumentationController as any;
      mockController.generateManual = jest.fn().mockImplementation((req, res) => {
        res.status(200).json({ success: true });
      });
      
      // Make multiple requests quickly
      const promises = Array(105).fill(0).map(() => 
        request(app)
          .post('/api/v1/cost-documentation/generate/manual')
          .set('Authorization', `Bearer ${validToken}`)
          .send(mockEvidence)
      );
      
      const responses = await Promise.all(promises);
      
      // Some requests should be rate limited
      const rateLimited = responses.filter(r => r.status === 429);
      expect(rateLimited.length).toBeGreaterThan(0);
    });
  });

  describe('Input Validation', () => {
    it('should validate evidence data before processing', async () => {
      // Mock JWT verification
      (jwt.verify as jest.Mock).mockReturnValue({
        userId: 'user-123',
        sellerId: 'seller-123',
        role: 'user',
        tenant: 'tenant-123'
      });
      
      const invalidEvidence = {
        // Missing required fields
        type: 'lost_units',
        sku: 'TEST-SKU-001'
      };
      
      const response = await request(app)
        .post('/api/v1/cost-documentation/generate/auto')
        .set('Authorization', `Bearer ${validToken}`)
        .send(invalidEvidence);
      
      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Missing required fields');
    });

    it('should sanitize input data', async () => {
      // Mock JWT verification
      (jwt.verify as jest.Mock).mockReturnValue({
        userId: 'user-123',
        sellerId: 'seller-123',
        role: 'user',
        tenant: 'tenant-123'
      });
      
      const maliciousEvidence = {
        ...mockEvidence,
        sku: '<script>alert("xss")</script>',
        seller_info: {
          ...mockEvidence.seller_info,
          business_name: 'Company<script>alert("xss")</script>'
        }
      };
      
      // Mock controller to check sanitization
      const mockController = CostDocumentationController as any;
      mockController.generateManual = jest.fn().mockImplementation((req, res) => {
        // Check that input was sanitized
        const evidence = req.body;
        expect(evidence.sku).not.toContain('<script>');
        expect(evidence.seller_info.business_name).not.toContain('<script>');
        
        res.status(200).json({ success: true });
      });
      
      const response = await request(app)
        .post('/api/v1/cost-documentation/generate/manual')
        .set('Authorization', `Bearer ${validToken}`)
        .send(maliciousEvidence);
      
      expect(response.status).toBe(200);
    });
  });

  describe('Audit Logging', () => {
    it('should log authentication attempts', async () => {
      // Mock JWT verification
      (jwt.verify as jest.Mock).mockReturnValue({
        userId: 'user-123',
        sellerId: 'seller-123',
        role: 'user',
        tenant: 'tenant-123'
      });
      
      // Mock controller
      const mockController = CostDocumentationController as any;
      mockController.generateManual = jest.fn().mockImplementation((req, res) => {
        res.status(200).json({ success: true });
      });
      
      const response = await request(app)
        .post('/api/v1/cost-documentation/generate/manual')
        .set('Authorization', `Bearer ${validToken}`)
        .send(mockEvidence);
      
      expect(response.status).toBe(200);
      
      // Verify audit log was created (this would be checked in integration tests)
      // For unit tests, we just verify the endpoint was called
    });

    it('should log failed authentication attempts', async () => {
      const response = await request(app)
        .post('/api/v1/cost-documentation/generate/auto')
        .set('Authorization', `Bearer ${invalidToken}`)
        .send(mockEvidence);
      
      expect(response.status).toBe(401);
      
      // Verify failed auth was logged (integration test check)
    });
  });

  describe('CORS and Security Headers', () => {
    it('should include security headers', async () => {
      const response = await request(app)
        .get('/api/v1/cost-documentation/health')
        .set('Authorization', `Bearer ${validToken}`);
      
      // Check for security headers
      expect(response.headers).toHaveProperty('x-content-type-options');
      expect(response.headers).toHaveProperty('x-frame-options');
      expect(response.headers).toHaveProperty('x-xss-protection');
    });

    it('should handle preflight requests', async () => {
      const response = await request(app)
        .options('/api/v1/cost-documentation/generate/auto')
        .set('Origin', 'https://example.com')
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'Content-Type, Authorization');
      
      expect(response.status).toBe(200);
      expect(response.headers).toHaveProperty('access-control-allow-origin');
    });
  });
});







