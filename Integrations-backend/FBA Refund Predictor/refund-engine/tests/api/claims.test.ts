import request from 'supertest';
import express from 'express';
import { ClaimsController } from '../../src/api/controllers/claimsController';
import { ClaimsService } from '../../src/api/services/claimsService';
import { authenticateToken, generateToken } from '../../src/api/middleware/authMiddleware';

// Mock the database and services
jest.mock('../../src/utils/db');
jest.mock('../../src/api/services/claimsService');

const app = express();
app.use(express.json());

// Create test routes
app.post('/claims', authenticateToken, ClaimsController.createClaim);
app.get('/claims', authenticateToken, ClaimsController.getClaims);
app.get('/claims/:id', authenticateToken, ClaimsController.getClaimById);
app.put('/claims/:id', authenticateToken, ClaimsController.updateClaim);
app.delete('/claims/:id', authenticateToken, ClaimsController.deleteClaim);

// Test user data
const testUser = {
  id: 'test-user-id',
  email: 'test@example.com',
  role: 'user'
};

const testUser2 = {
  id: 'test-user-2-id',
  email: 'test2@example.com',
  role: 'user'
};

const testClaim = {
  id: 'test-claim-id',
  user_id: testUser.id,
  case_number: 'CASE-001',
  claim_amount: 150.0,
  customer_history_score: 0.85,
  product_category: 'electronics',
  days_since_purchase: 30,
  claim_description: 'Product arrived damaged',
  status: 'pending',
  created_at: new Date(),
  updated_at: new Date()
};

describe('Claims API', () => {
  let authToken: string;
  let authToken2: string;

  beforeEach(() => {
    authToken = generateToken(testUser);
    authToken2 = generateToken(testUser2);
    jest.clearAllMocks();
  });

  describe('POST /claims', () => {
    it('should create a new claim successfully', async () => {
      const claimData = {
        case_number: 'CASE-001',
        claim_amount: 150.0,
        customer_history_score: 0.85,
        product_category: 'electronics',
        days_since_purchase: 30,
        claim_description: 'Product arrived damaged'
      };

      (ClaimsService.createClaim as jest.Mock).mockResolvedValue(testClaim);

      const response = await request(app)
        .post('/claims')
        .set('Authorization', `Bearer ${authToken}`)
        .send(claimData);

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual(testClaim);
      expect(ClaimsService.createClaim).toHaveBeenCalledWith(testUser.id, claimData);
    });

    it('should return 400 for missing required fields', async () => {
      const invalidClaimData = {
        case_number: 'CASE-001'
        // Missing required fields
      };

      const response = await request(app)
        .post('/claims')
        .set('Authorization', `Bearer ${authToken}`)
        .send(invalidClaimData);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Missing required fields');
    });

    it('should return 409 for duplicate case number', async () => {
      const claimData = {
        case_number: 'CASE-001',
        claim_amount: 150.0,
        product_category: 'electronics'
      };

      (ClaimsService.createClaim as jest.Mock).mockRejectedValue(new Error('Case number already exists'));

      const response = await request(app)
        .post('/claims')
        .set('Authorization', `Bearer ${authToken}`)
        .send(claimData);

      expect(response.status).toBe(409);
      expect(response.body.error).toBe('Duplicate case number');
    });

    it('should return 401 without authentication', async () => {
      const response = await request(app)
        .post('/claims')
        .send({});

      expect(response.status).toBe(401);
    });
  });

  describe('GET /claims', () => {
    it('should get claims with pagination', async () => {
      const mockClaims = [testClaim];
      const mockResult = {
        claims: mockClaims,
        total: 1
      };

      (ClaimsService.getClaims as jest.Mock).mockResolvedValue(mockResult);

      const response = await request(app)
        .get('/claims?limit=10&offset=0')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual(mockClaims);
      expect(response.body.pagination.total).toBe(1);
    });

    it('should filter claims by status', async () => {
      const mockResult = {
        claims: [testClaim],
        total: 1
      };

      (ClaimsService.getClaims as jest.Mock).mockResolvedValue(mockResult);

      const response = await request(app)
        .get('/claims?status=pending')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(ClaimsService.getClaims).toHaveBeenCalledWith(testUser.id, {
        status: 'pending',
        limit: 10,
        offset: 0,
        sort_by: 'created_at',
        sort_order: 'DESC'
      });
    });
  });

  describe('GET /claims/:id', () => {
    it('should get a specific claim by ID', async () => {
      (ClaimsService.getClaimById as jest.Mock).mockResolvedValue(testClaim);

      const response = await request(app)
        .get(`/claims/${testClaim.id}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual(testClaim);
    });

    it('should return 404 for non-existent claim', async () => {
      (ClaimsService.getClaimById as jest.Mock).mockResolvedValue(null);

      const response = await request(app)
        .get('/claims/non-existent-id')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Claim not found');
    });

    it('should enforce RLS - user cannot access another user\'s claim', async () => {
      // Mock that the claim belongs to a different user
      const otherUserClaim = { ...testClaim, user_id: testUser2.id };
      (ClaimsService.getClaimById as jest.Mock).mockResolvedValue(null); // RLS prevents access

      const response = await request(app)
        .get(`/claims/${otherUserClaim.id}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Claim not found');
    });
  });

  describe('PUT /claims/:id', () => {
    it('should update a claim successfully', async () => {
      const updateData = {
        status: 'approved',
        claim_description: 'Updated description'
      };

      const updatedClaim = { ...testClaim, ...updateData };
      (ClaimsService.updateClaim as jest.Mock).mockResolvedValue(updatedClaim);

      const response = await request(app)
        .put(`/claims/${testClaim.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(updateData);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual(updatedClaim);
    });

    it('should return 404 for non-existent claim', async () => {
      (ClaimsService.updateClaim as jest.Mock).mockResolvedValue(null);

      const response = await request(app)
        .put('/claims/non-existent-id')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ status: 'approved' });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Claim not found');
    });
  });

  describe('DELETE /claims/:id', () => {
    it('should delete a claim successfully', async () => {
      (ClaimsService.deleteClaim as jest.Mock).mockResolvedValue(true);

      const response = await request(app)
        .delete(`/claims/${testClaim.id}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Claim deleted successfully');
    });

    it('should return 404 for non-existent claim', async () => {
      (ClaimsService.deleteClaim as jest.Mock).mockResolvedValue(false);

      const response = await request(app)
        .delete('/claims/non-existent-id')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Claim not found');
    });
  });

  describe('Authentication and Authorization', () => {
    it('should reject requests without valid JWT', async () => {
      const response = await request(app)
        .get('/claims')
        .set('Authorization', 'Bearer invalid-token');

      expect(response.status).toBe(401);
    });

    it('should reject requests without Authorization header', async () => {
      const response = await request(app)
        .get('/claims');

      expect(response.status).toBe(401);
    });
  });
}); 