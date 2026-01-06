import request from 'supertest';
import express from 'express';
import { CertaintyController } from '../src/api/controllers/certaintyController';
import { CertaintyEngine, ClaimPayload, ScoringResult } from '../src/api/services/certaintyEngine';
import { CertaintyRepo } from '../src/api/services/certaintyRepo';

// Mock the CertaintyRepo to avoid real DB calls
jest.mock('../src/api/services/certaintyRepo', () => ({
  CertaintyRepo: {
    insertCertaintyScore: jest.fn().mockResolvedValue({
      id: "certainty-1",
      claim_id: "claim-1",
      refund_probability: 0.75,
      risk_level: "High",
      created_at: "2024-01-15T10:00:00Z"
    }),
    getCertaintyScoresByClaim: jest.fn().mockResolvedValue([
      {
        id: "certainty-1",
        claim_id: "claim-1",
        refund_probability: 0.75,
        risk_level: "High",
        created_at: "2024-01-15T10:00:00Z"
      }
    ]),
    getLatestCertaintyScore: jest.fn().mockResolvedValue({
      id: "certainty-1",
      claim_id: "claim-1",
      refund_probability: 0.75,
      risk_level: "High",
      created_at: "2024-01-15T10:00:00Z"
    }),
    getCertaintyScoreStats: jest.fn().mockResolvedValue({
      total_scores: 150,
      average_probability: 0.62,
      risk_level_distribution: { 'Low': 45, 'Medium': 78, 'High': 27 },
      recent_scores_24h: 12
    })
  }
}));

// Mock auth middleware
jest.mock('../src/api/middleware/authMiddleware', () => ({
  authenticateToken: () => (req: any, res: any, next: any) => {
    req.user = { id: 'test-user', email: 'test@example.com' };
    next();
  }
}));

describe('Certainty Engine MVP', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    
    // Mount the certainty routes
    const certaintyRoutes = require('../src/api/routes/certaintyRoutes').default;
    app.use('/api/v1/certainty', certaintyRoutes);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /api/v1/certainty/score', () => {
    const validClaimPayload = {
      claim_id: 'claim-1',
      actor_id: 'actor-1',
      invoice_text: 'Vendor: Amazon FBA, Invoice Number: INV-2024-001, Date: 2024-01-15, Overcharge detected on shipping fees $150.00',
      proof_bundle_id: 'proof-1',
      claim_amount: 150.00,
      anomaly_score: 0.9,
      claim_type: 'invoice_text'
    };

    it('should score a claim successfully with valid payload', async () => {
      const response = await request(app)
        .post('/api/v1/certainty/score')
        .send(validClaimPayload)
        .expect(201);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('data');
      expect(response.body.data).toHaveProperty('certainty_score');
      expect(response.body.data).toHaveProperty('scoring_details');
      
      // Verify certainty score data
      expect(response.body.data.certainty_score).toHaveProperty('id', 'certainty-1');
      expect(response.body.data.certainty_score).toHaveProperty('claim_id', 'claim-1');
      expect(response.body.data.certainty_score).toHaveProperty('refund_probability');
      expect(response.body.data.certainty_score).toHaveProperty('risk_level');
      
      // Verify scoring details
      expect(response.body.data.scoring_details).toHaveProperty('refund_probability');
      expect(response.body.data.scoring_details).toHaveProperty('risk_level');
      expect(response.body.data.scoring_details).toHaveProperty('confidence');
      expect(response.body.data.scoring_details).toHaveProperty('factors');
    });

    it('should return 400 for missing required fields', async () => {
      const invalidPayload = {
        claim_id: 'claim-1',
        // Missing actor_id, invoice_text, proof_bundle_id
        claim_amount: 150.00
      };

      const response = await request(app)
        .post('/api/v1/certainty/score')
        .send(invalidPayload)
        .expect(400);

      expect(response.body).toHaveProperty('success', false);
      expect(response.body).toHaveProperty('error', 'Missing required fields');
    });

    it('should return 400 for missing claim_id', async () => {
      const invalidPayload = {
        actor_id: 'actor-1',
        invoice_text: 'Test invoice text',
        proof_bundle_id: 'proof-1'
      };

      const response = await request(app)
        .post('/api/v1/certainty/score')
        .send(invalidPayload)
        .expect(400);

      expect(response.body).toHaveProperty('success', false);
      expect(response.body).toHaveProperty('error', 'Missing required fields');
    });

    it('should return 400 for missing invoice_text', async () => {
      const invalidPayload = {
        claim_id: 'claim-1',
        actor_id: 'actor-1',
        proof_bundle_id: 'proof-1'
      };

      const response = await request(app)
        .post('/api/v1/certainty/score')
        .send(invalidPayload)
        .expect(400);

      expect(response.body).toHaveProperty('success', false);
      expect(response.body).toHaveProperty('error', 'Missing required fields');
    });

    it('should return 400 for missing proof_bundle_id', async () => {
      const invalidPayload = {
        claim_id: 'claim-1',
        actor_id: 'actor-1',
        invoice_text: 'Test invoice text'
      };

      const response = await request(app)
        .post('/api/v1/certainty/score')
        .send(invalidPayload)
        .expect(400);

      expect(response.body).toHaveProperty('success', false);
      expect(response.body).toHaveProperty('error', 'Missing required fields');
    });

    it('should handle service errors gracefully', async () => {
      // Mock the service to throw an error
      const { CertaintyEngine } = require('../src/api/services/certaintyEngine');
      CertaintyEngine.scoreClaim.mockRejectedValueOnce(new Error('Scoring engine failed'));

      const response = await request(app)
        .post('/api/v1/certainty/score')
        .send(validClaimPayload)
        .expect(500);

      expect(response.body).toHaveProperty('success', false);
      expect(response.body).toHaveProperty('error', 'Internal server error');
    });
  });

  describe('GET /api/v1/certainty/scores/:claim_id', () => {
    it('should retrieve certainty scores for a claim successfully', async () => {
      const response = await request(app)
        .get('/api/v1/certainty/scores/claim-1')
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('data');
      expect(response.body.data).toHaveProperty('claim_id', 'claim-1');
      expect(response.body.data).toHaveProperty('certainty_scores');
      expect(response.body.data).toHaveProperty('count', 1);
      
      expect(response.body.data.certainty_scores).toHaveLength(1);
      expect(response.body.data.certainty_scores[0]).toHaveProperty('id', 'certainty-1');
      expect(response.body.data.certainty_scores[0]).toHaveProperty('risk_level', 'High');
    });

    it('should return 400 for missing claim ID', async () => {
      const response = await request(app)
        .get('/api/v1/certainty/scores/')
        .expect(404);
    });

    it('should handle service errors gracefully', async () => {
      // Mock the service to throw an error
      const { CertaintyRepo } = require('../src/api/services/certaintyRepo');
      CertaintyRepo.getCertaintyScoresByClaim.mockRejectedValueOnce(new Error('Database connection failed'));

      const response = await request(app)
        .get('/api/v1/certainty/scores/claim-1')
        .expect(500);

      expect(response.body).toHaveProperty('success', false);
      expect(response.body).toHaveProperty('error', 'Internal server error');
    });
  });

  describe('GET /api/v1/certainty/scores/:claim_id/latest', () => {
    it('should retrieve the latest certainty score for a claim successfully', async () => {
      const response = await request(app)
        .get('/api/v1/certainty/scores/claim-1/latest')
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('data');
      expect(response.body.data).toHaveProperty('claim_id', 'claim-1');
      expect(response.body.data).toHaveProperty('latest_certainty_score');
      
      expect(response.body.data.latest_certainty_score).toHaveProperty('id', 'certainty-1');
      expect(response.body.data.latest_certainty_score).toHaveProperty('risk_level', 'High');
    });

    it('should return 404 when no certainty score exists', async () => {
      // Mock the service to return null
      const { CertaintyRepo } = require('../src/api/services/certaintyRepo');
      CertaintyRepo.getLatestCertaintyScore.mockResolvedValueOnce(null);

      const response = await request(app)
        .get('/api/v1/certainty/scores/claim-nonexistent/latest')
        .expect(404);

      expect(response.body).toHaveProperty('success', false);
      expect(response.body).toHaveProperty('error', 'No certainty score found');
    });
  });

  describe('GET /api/v1/certainty/stats', () => {
    it('should retrieve certainty score statistics successfully', async () => {
      const response = await request(app)
        .get('/api/v1/certainty/stats')
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('data');
      expect(response.body.data).toHaveProperty('total_scores', 150);
      expect(response.body.data).toHaveProperty('average_probability', 0.62);
      expect(response.body.data).toHaveProperty('risk_level_distribution');
      expect(response.body.data).toHaveProperty('recent_scores_24h', 12);
      
      expect(response.body.data.risk_level_distribution).toEqual({
        'Low': 45,
        'Medium': 78,
        'High': 27
      });
    });
  });

  describe('Certainty Engine Core Logic', () => {
    it('should generate deterministic scores for same inputs', async () => {
      const payload: ClaimPayload = {
        claim_id: 'test-claim',
        actor_id: 'test-actor',
        invoice_text: 'Vendor: Test Vendor, Overcharge detected $100.00',
        proof_bundle_id: 'test-proof',
        claim_amount: 100.00,
        anomaly_score: 0.8
      };

      const result1 = await CertaintyEngine.scoreClaim(payload);
      const result2 = await CertaintyEngine.scoreClaim(payload);

      // Same input should produce same output
      expect(result1.refund_probability).toBe(result2.refund_probability);
      expect(result1.risk_level).toBe(result2.risk_level);
      expect(result1.confidence).toBe(result2.confidence);
      expect(result1.factors).toEqual(result2.factors);
    });

    it('should map probability to correct risk levels', async () => {
      const testCases = [
        { probability: 0.2, expectedRisk: 'Low' },
        { probability: 0.3, expectedRisk: 'Medium' },
        { probability: 0.5, expectedRisk: 'Medium' },
        { probability: 0.7, expectedRisk: 'Medium' },
        { probability: 0.8, expectedRisk: 'High' }
      ];

      for (const testCase of testCases) {
        const payload: ClaimPayload = {
          claim_id: 'test-claim',
          actor_id: 'test-actor',
          invoice_text: 'Test invoice',
          proof_bundle_id: 'test-proof'
        };

        // Mock the scoring to return specific probability
        const mockResult: ScoringResult = {
          refund_probability: testCase.probability,
          risk_level: 'Low', // This will be overridden
          confidence: 0.8,
          factors: ['Test factor']
        };

        jest.spyOn(CertaintyEngine, 'scoreClaim').mockResolvedValueOnce(mockResult);

        const result = await CertaintyEngine.scoreClaim(payload);
        
        // The risk level should be correctly mapped based on probability
        if (testCase.probability < 0.3) {
          expect(result.risk_level).toBe('Low');
        } else if (testCase.probability <= 0.7) {
          expect(result.risk_level).toBe('Medium');
        } else {
          expect(result.risk_level).toBe('High');
        }
      }
    });

    it('should extract features correctly from invoice text', async () => {
      const payload: ClaimPayload = {
        claim_id: 'test-claim',
        actor_id: 'test-actor',
        invoice_text: 'Vendor: Amazon FBA, Overcharge detected $150.00, Damaged goods reported',
        proof_bundle_id: 'test-proof',
        claim_amount: 150.00,
        anomaly_score: 0.9
      };

      const result = await CertaintyEngine.scoreClaim(payload);

      // Should detect overcharge and damage
      expect(result.factors).toContain('Overcharge detected');
      expect(result.factors).toContain('Damage reported');
      
      // Should have high confidence due to strong evidence
      expect(result.confidence).toBeGreaterThan(0.7);
      
      // Should be high risk due to multiple issues
      expect(result.risk_level).toBe('High');
    });

    it('should handle high-value claims with appropriate scoring', async () => {
      const highValuePayload: ClaimPayload = {
        claim_id: 'test-claim',
        actor_id: 'test-actor',
        invoice_text: 'Vendor: Test Vendor, Overcharge detected $1500.00',
        proof_bundle_id: 'test-proof',
        claim_amount: 1500.00,
        anomaly_score: 0.8
      };

      const result = await CertaintyEngine.scoreClaim(highValuePayload);

      // High-value claims should get slight penalty but still be high risk
      expect(result.risk_level).toBe('High');
      expect(result.refund_probability).toBeGreaterThan(0.6);
    });

    it('should calculate confidence based on evidence quality', async () => {
      const strongEvidencePayload: ClaimPayload = {
        claim_id: 'test-claim',
        actor_id: 'test-actor',
        invoice_text: 'Vendor: Test Vendor, Invoice Number: INV-001, Order Reference: PO-123, Overcharge detected $100.00',
        proof_bundle_id: 'test-proof',
        claim_amount: 100.00,
        anomaly_score: 0.9
      };

      const result = await CertaintyEngine.scoreClaim(strongEvidencePayload);

      // Should have high confidence due to:
      // - Proof bundle exists
      // - High anomaly score
      // - Long, structured text
      // - Specific issue types
      expect(result.confidence).toBeGreaterThan(0.8);
    });
  });

  describe('Certainty Repository Operations', () => {
    it('should insert certainty scores successfully', async () => {
      const scoreData = {
        claim_id: 'test-claim',
        refund_probability: 0.75,
        risk_level: 'High' as const
      };

      const result = await CertaintyRepo.insertCertaintyScore(scoreData);

      expect(result).toHaveProperty('id');
      expect(result).toHaveProperty('claim_id', 'test-claim');
      expect(result).toHaveProperty('refund_probability', 0.75);
      expect(result).toHaveProperty('risk_level', 'High');
      expect(result).toHaveProperty('created_at');
    });

    it('should retrieve certainty scores by claim ID', async () => {
      const scores = await CertaintyRepo.getCertaintyScoresByClaim('test-claim');

      expect(Array.isArray(scores)).toBe(true);
      expect(scores.length).toBeGreaterThan(0);
      expect(scores[0]).toHaveProperty('claim_id', 'test-claim');
    });

    it('should get latest certainty score for a claim', async () => {
      const latestScore = await CertaintyRepo.getLatestCertaintyScore('test-claim');

      expect(latestScore).toHaveProperty('id');
      expect(latestScore).toHaveProperty('claim_id', 'test-claim');
      expect(latestScore).toHaveProperty('refund_probability');
      expect(latestScore).toHaveProperty('risk_level');
    });

    it('should get certainty score statistics', async () => {
      const stats = await CertaintyRepo.getCertaintyScoreStats();

      expect(stats).toHaveProperty('total_scores');
      expect(stats).toHaveProperty('average_probability');
      expect(stats).toHaveProperty('risk_level_distribution');
      expect(stats).toHaveProperty('recent_scores_24h');
      
      expect(typeof stats.total_scores).toBe('number');
      expect(typeof stats.average_probability).toBe('number');
      expect(typeof stats.risk_level_distribution).toBe('object');
    });
  });

  describe('MVP Constraints and Future Hooks', () => {
    it('should use deterministic scoring (no ML model yet)', async () => {
      const payload: ClaimPayload = {
        claim_id: 'test-claim',
        actor_id: 'test-actor',
        invoice_text: 'Vendor: Test Vendor, Overcharge detected $100.00',
        proof_bundle_id: 'test-proof',
        claim_amount: 100.00,
        anomaly_score: 0.8
      };

      const result1 = await CertaintyEngine.scoreClaim(payload);
      
      // Wait a bit and score again
      await new Promise(resolve => setTimeout(resolve, 100));
      const result2 = await CertaintyEngine.scoreClaim(payload);

      // Results should be identical (deterministic)
      expect(result1.refund_probability).toBe(result2.refund_probability);
      expect(result1.risk_level).toBe(result2.risk_level);
      expect(result1.confidence).toBe(result2.confidence);
      expect(result1.factors).toEqual(result2.factors);
    });

    it('should handle various invoice text patterns', async () => {
      const testCases = [
        {
          text: 'Overcharge detected on shipping fees',
          expectedFactors: ['Overcharge detected']
        },
        {
          text: 'Damaged inventory reported, lost units',
          expectedFactors: ['Damage reported', 'Lost inventory']
        },
        {
          text: 'Shipping problem with delivery',
          expectedFactors: ['Shipping problem']
        },
        {
          text: 'Storage issue in warehouse',
          expectedFactors: ['Storage issue']
        }
      ];

      for (const testCase of testCases) {
        const payload: ClaimPayload = {
          claim_id: 'test-claim',
          actor_id: 'test-actor',
          invoice_text: testCase.text,
          proof_bundle_id: 'test-proof'
        };

        const result = await CertaintyEngine.scoreClaim(payload);

        // Should contain expected factors
        for (const expectedFactor of testCase.expectedFactors) {
          expect(result.factors).toContain(expectedFactor);
        }
      }
    });

    it('should provide confidence scores for decision making', async () => {
      const payload: ClaimPayload = {
        claim_id: 'test-claim',
        actor_id: 'test-actor',
        invoice_text: 'Vendor: Test Vendor, Invoice Number: INV-001, Overcharge detected $100.00',
        proof_bundle_id: 'test-proof',
        claim_amount: 100.00,
        anomaly_score: 0.9
      };

      const result = await CertaintyEngine.scoreClaim(payload);

      // Confidence should be a number between 0 and 1
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
      
      // Should have reasonable confidence for good evidence
      expect(result.confidence).toBeGreaterThan(0.6);
    });
  });
});
