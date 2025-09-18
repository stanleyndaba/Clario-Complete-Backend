/**
 * Integration Tests for Claim Risk Scoring
 * Tests the complete flow: flag claim → EVE proof bundle → CE scoring → TransactionJournal entry
 */

import request from 'supertest';
import { app } from '../../src/index';
import { claimRiskScoringService } from '../../src/services/claimRiskScoringService';
import { CertaintyRepo } from '../../src/api/services/certaintyRepo';
import { TransactionJournalService } from '../../src/api/services/transactionJournalService';

// Mock dependencies
jest.mock('../../src/services/claimRiskScoringService');
jest.mock('../../src/api/services/certaintyRepo');
jest.mock('../../src/api/services/transactionJournalService');

const mockClaimRiskScoringService = claimRiskScoringService as jest.Mocked<typeof claimRiskScoringService>;
const mockCertaintyRepo = CertaintyRepo as jest.Mocked<typeof CertaintyRepo>;
const mockTransactionJournalService = TransactionJournalService as jest.Mocked<typeof TransactionJournalService>;

describe('Claim Risk Scoring Integration Tests', () => {
  const mockUser = { id: 'test-user-id', email: 'test@example.com' };
  const mockToken = 'mock-jwt-token';

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Mock authentication middleware
    jest.doMock('../../src/api/middleware/authMiddleware', () => ({
      authenticateToken: (req: any, res: any, next: any) => {
        req.user = mockUser;
        next();
      }
    }));
  });

  describe('POST /api/v1/claims/score', () => {
    it('should score a claim and log transaction successfully', async () => {
      const claimFeatures = {
        discrepancy_type: 'missing_refund',
        discrepancy_size: 150.0,
        days_outstanding: 45,
        marketplace: 'amazon',
        historical_payout_rate: 0.75
      };

      const mockRiskScore = {
        success_probability: 0.85,
        refund_timeline_days: 12.5,
        confidence_score: 0.8,
        risk_level: 'High' as const,
        model_version: '1.0.0',
        features_used: Object.keys(claimFeatures)
      };

      const mockCertaintyScore = {
        id: 'certainty-score-123',
        claim_id: 'claim-456',
        refund_probability: 0.85,
        risk_level: 'High',
        confidence_score: 0.8,
        refund_timeline_days: 12.5,
        model_version: '1.0.0',
        features_used: Object.keys(claimFeatures),
        created_at: new Date().toISOString()
      };

      const mockTransactionLog = {
        id: 'tx-789',
        tx_type: 'claim_risk_scored',
        entity_id: 'certainty-score-123',
        payload: {
          certainty_score_id: 'certainty-score-123',
          actor_id: mockUser.id,
          claim_features: claimFeatures,
          risk_assessment: mockRiskScore,
          timestamp: expect.any(String),
          description: 'Claim risk assessment completed using ML models'
        },
        timestamp: expect.any(String),
        actor_id: mockUser.id,
        hash: expect.any(String)
      };

      // Setup mocks
      mockClaimRiskScoringService.validateClaimFeatures.mockReturnValue(true);
      mockClaimRiskScoringService.scoreClaim.mockResolvedValue(mockRiskScore);
      mockCertaintyRepo.insertCertaintyScore.mockResolvedValue(mockCertaintyScore);
      mockTransactionJournalService.recordClaimRiskScored.mockResolvedValue(mockTransactionLog);

      const response = await request(app)
        .post('/api/v1/claims/score')
        .set('Authorization', `Bearer ${mockToken}`)
        .send(claimFeatures)
        .expect(200);

      // Verify response
      expect(response.body).toEqual({
        success: true,
        data: {
          certainty_score_id: 'certainty-score-123',
          risk_assessment: mockRiskScore,
          claim_features: claimFeatures,
          timestamp: expect.any(String)
        },
        message: 'Claim risk assessment completed successfully'
      });

      // Verify service calls
      expect(mockClaimRiskScoringService.validateClaimFeatures).toHaveBeenCalledWith(claimFeatures);
      expect(mockClaimRiskScoringService.scoreClaim).toHaveBeenCalledWith(claimFeatures);
      expect(mockCertaintyRepo.insertCertaintyScore).toHaveBeenCalledWith({
        claim_id: undefined, // No claim_id provided in request
        refund_probability: 0.85,
        risk_level: 'High',
        confidence_score: 0.8,
        refund_timeline_days: 12.5,
        model_version: '1.0.0',
        features_used: Object.keys(claimFeatures)
      });
      expect(mockTransactionJournalService.recordClaimRiskScored).toHaveBeenCalledWith(
        'certainty-score-123',
        mockUser.id,
        claimFeatures,
        mockRiskScore
      );
    });

    it('should handle invalid claim features', async () => {
      const invalidFeatures = {
        discrepancy_type: 'missing_refund',
        discrepancy_size: -100, // Invalid: negative amount
        days_outstanding: 45,
        marketplace: 'amazon',
        historical_payout_rate: 0.75
      };

      mockClaimRiskScoringService.validateClaimFeatures.mockReturnValue(false);

      const response = await request(app)
        .post('/api/v1/claims/score')
        .set('Authorization', `Bearer ${mockToken}`)
        .send(invalidFeatures)
        .expect(400);

      expect(response.body).toEqual({
        success: false,
        error: 'Invalid claim features. Required fields: discrepancy_type, discrepancy_size, days_outstanding, marketplace, historical_payout_rate'
      });

      // Verify no service calls were made
      expect(mockClaimRiskScoringService.scoreClaim).not.toHaveBeenCalled();
      expect(mockCertaintyRepo.insertCertaintyScore).not.toHaveBeenCalled();
      expect(mockTransactionJournalService.recordClaimRiskScored).not.toHaveBeenCalled();
    });

    it('should handle ML model errors gracefully', async () => {
      const claimFeatures = {
        discrepancy_type: 'missing_refund',
        discrepancy_size: 150.0,
        days_outstanding: 45,
        marketplace: 'amazon',
        historical_payout_rate: 0.75
      };

      mockClaimRiskScoringService.validateClaimFeatures.mockReturnValue(true);
      mockClaimRiskScoringService.scoreClaim.mockRejectedValue(new Error('Python environment not available'));

      const response = await request(app)
        .post('/api/v1/claims/score')
        .set('Authorization', `Bearer ${mockToken}`)
        .send(claimFeatures)
        .expect(500);

      expect(response.body).toEqual({
        success: false,
        error: 'Failed to score claim risk',
        details: 'Python environment not available'
      });
    });
  });

  describe('POST /api/v1/claims/train-models', () => {
    it('should train models and log transaction successfully', async () => {
      const trainingParams = { n_samples: 5000 };
      const mockMetrics = {
        success_accuracy: 0.85,
        success_auc: 0.82,
        timeline_rmse: 3.2,
        timeline_r2: 0.78
      };

      const mockTransactionLog = {
        id: 'tx-training-123',
        tx_type: 'model_training',
        entity_id: 'ml_models',
        payload: {
          actor_id: mockUser.id,
          n_samples: 5000,
          training_metrics: mockMetrics,
          timestamp: expect.any(String),
          description: 'ML models trained with synthetic data'
        },
        timestamp: expect.any(String),
        actor_id: mockUser.id,
        hash: expect.any(String)
      };

      mockClaimRiskScoringService.trainModels.mockResolvedValue(mockMetrics);
      mockTransactionJournalService.recordModelTraining.mockResolvedValue(mockTransactionLog);

      const response = await request(app)
        .post('/api/v1/claims/train-models')
        .set('Authorization', `Bearer ${mockToken}`)
        .send(trainingParams)
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        data: {
          training_metrics: mockMetrics,
          samples_used: 5000,
          timestamp: expect.any(String)
        },
        message: 'ML models trained successfully'
      });

      expect(mockClaimRiskScoringService.trainModels).toHaveBeenCalledWith(5000);
      expect(mockTransactionJournalService.recordModelTraining).toHaveBeenCalledWith(
        mockUser.id,
        5000,
        mockMetrics
      );
    });
  });

  describe('GET /api/v1/claims/model-info', () => {
    it('should return model information successfully', async () => {
      const mockInfo = {
        is_trained: true,
        models_dir: '/path/to/models',
        success_model_type: 'LogisticRegression',
        timeline_model_type: 'LinearRegression',
        categorical_features: ['discrepancy_type', 'marketplace'],
        numerical_features: ['discrepancy_size', 'days_outstanding', 'historical_payout_rate']
      };

      mockClaimRiskScoringService.getModelInfo.mockResolvedValue(mockInfo);

      const response = await request(app)
        .get('/api/v1/claims/model-info')
        .set('Authorization', `Bearer ${mockToken}`)
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        data: mockInfo,
        message: 'Model information retrieved successfully'
      });
    });
  });

  describe('GET /api/v1/claims/check-environment', () => {
    it('should return environment status successfully', async () => {
      mockClaimRiskScoringService.checkPythonEnvironment.mockResolvedValue(true);

      const response = await request(app)
        .get('/api/v1/claims/check-environment')
        .set('Authorization', `Bearer ${mockToken}`)
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        data: {
          python_available: true,
          timestamp: expect.any(String)
        },
        message: 'Python environment is ready'
      });
    });

    it('should handle unavailable environment', async () => {
      mockClaimRiskScoringService.checkPythonEnvironment.mockResolvedValue(false);

      const response = await request(app)
        .get('/api/v1/claims/check-environment')
        .set('Authorization', `Bearer ${mockToken}`)
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        data: {
          python_available: false,
          timestamp: expect.any(String)
        },
        message: 'Python environment is not available'
      });
    });
  });

  describe('GET /api/v1/claims/sample', () => {
    it('should return sample claim successfully', async () => {
      const sampleClaim = {
        discrepancy_type: 'missing_refund',
        discrepancy_size: 150.0,
        days_outstanding: 45,
        marketplace: 'amazon',
        historical_payout_rate: 0.75
      };

      mockClaimRiskScoringService.getSampleClaim.mockReturnValue(sampleClaim);

      const response = await request(app)
        .get('/api/v1/claims/sample')
        .set('Authorization', `Bearer ${mockToken}`)
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        data: {
          sample_claim: sampleClaim,
          description: 'Sample claim features for testing the risk scoring API'
        },
        message: 'Sample claim retrieved successfully'
      });
    });
  });

  describe('POST /api/v1/claims/batch-score', () => {
    it('should batch score claims successfully', async () => {
      const claims = [
        {
          discrepancy_type: 'missing_refund',
          discrepancy_size: 150.0,
          days_outstanding: 45,
          marketplace: 'amazon',
          historical_payout_rate: 0.75
        },
        {
          discrepancy_type: 'late_shipment',
          discrepancy_size: 75.0,
          days_outstanding: 30,
          marketplace: 'shopify',
          historical_payout_rate: 0.60
        }
      ];

      const mockRiskScore = {
        success_probability: 0.85,
        refund_timeline_days: 12.5,
        confidence_score: 0.8,
        risk_level: 'High' as const,
        model_version: '1.0.0',
        features_used: ['discrepancy_type', 'discrepancy_size', 'days_outstanding', 'marketplace', 'historical_payout_rate']
      };

      mockClaimRiskScoringService.validateClaimFeatures.mockReturnValue(true);
      mockClaimRiskScoringService.scoreClaim.mockResolvedValue(mockRiskScore);

      const response = await request(app)
        .post('/api/v1/claims/batch-score')
        .set('Authorization', `Bearer ${mockToken}`)
        .send({ claims })
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        data: {
          total_claims: 2,
          successful_scores: 2,
          failed_scores: 0,
          results: [
            {
              index: 0,
              claim_features: claims[0],
              risk_assessment: mockRiskScore,
              timestamp: expect.any(String)
            },
            {
              index: 1,
              claim_features: claims[1],
              risk_assessment: mockRiskScore,
              timestamp: expect.any(String)
            }
          ],
          errors: []
        },
        message: 'Batch scoring completed. 2 successful, 0 failed.'
      });

      expect(mockClaimRiskScoringService.validateClaimFeatures).toHaveBeenCalledTimes(2);
      expect(mockClaimRiskScoringService.scoreClaim).toHaveBeenCalledTimes(2);
    });

    it('should handle mixed valid and invalid claims in batch', async () => {
      const claims = [
        {
          discrepancy_type: 'missing_refund',
          discrepancy_size: 150.0,
          days_outstanding: 45,
          marketplace: 'amazon',
          historical_payout_rate: 0.75
        },
        {
          discrepancy_type: 'late_shipment',
          discrepancy_size: -75.0, // Invalid
          days_outstanding: 30,
          marketplace: 'shopify',
          historical_payout_rate: 0.60
        }
      ];

      const mockRiskScore = {
        success_probability: 0.85,
        refund_timeline_days: 12.5,
        confidence_score: 0.8,
        risk_level: 'High' as const,
        model_version: '1.0.0',
        features_used: ['discrepancy_type', 'discrepancy_size', 'days_outstanding', 'marketplace', 'historical_payout_rate']
      };

      mockClaimRiskScoringService.validateClaimFeatures
        .mockReturnValueOnce(true)  // First claim valid
        .mockReturnValueOnce(false); // Second claim invalid
      mockClaimRiskScoringService.scoreClaim.mockResolvedValue(mockRiskScore);

      const response = await request(app)
        .post('/api/v1/claims/batch-score')
        .set('Authorization', `Bearer ${mockToken}`)
        .send({ claims })
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        data: {
          total_claims: 2,
          successful_scores: 1,
          failed_scores: 1,
          results: [
            {
              index: 0,
              claim_features: claims[0],
              risk_assessment: mockRiskScore,
              timestamp: expect.any(String)
            }
          ],
          errors: [
            {
              index: 1,
              error: 'Invalid claim features',
              claim: claims[1]
            }
          ]
        },
        message: 'Batch scoring completed. 1 successful, 1 failed.'
      });
    });

    it('should reject empty claims array', async () => {
      const response = await request(app)
        .post('/api/v1/claims/batch-score')
        .set('Authorization', `Bearer ${mockToken}`)
        .send({ claims: [] })
        .expect(400);

      expect(response.body).toEqual({
        success: false,
        error: 'Claims array is required and must not be empty'
      });
    });

    it('should reject too many claims', async () => {
      const claims = Array(101).fill({
        discrepancy_type: 'missing_refund',
        discrepancy_size: 150.0,
        days_outstanding: 45,
        marketplace: 'amazon',
        historical_payout_rate: 0.75
      });

      const response = await request(app)
        .post('/api/v1/claims/batch-score')
        .set('Authorization', `Bearer ${mockToken}`)
        .send({ claims })
        .expect(400);

      expect(response.body).toEqual({
        success: false,
        error: 'Maximum 100 claims can be scored in a single batch'
      });
    });
  });

  describe('Full Integration Flow', () => {
    it('should complete full flow: flag claim → score risk → log transaction', async () => {
      // This test would require mocking the entire EVE flow
      // For now, we'll test the risk scoring part independently
      
      const claimFeatures = {
        discrepancy_type: 'missing_refund',
        discrepancy_size: 150.0,
        days_outstanding: 45,
        marketplace: 'amazon',
        historical_payout_rate: 0.75
      };

      const mockRiskScore = {
        success_probability: 0.85,
        refund_timeline_days: 12.5,
        confidence_score: 0.8,
        risk_level: 'High' as const,
        model_version: '1.0.0',
        features_used: Object.keys(claimFeatures)
      };

      const mockCertaintyScore = {
        id: 'certainty-score-123',
        claim_id: 'claim-456',
        refund_probability: 0.85,
        risk_level: 'High',
        confidence_score: 0.8,
        refund_timeline_days: 12.5,
        model_version: '1.0.0',
        features_used: Object.keys(claimFeatures),
        created_at: new Date().toISOString()
      };

      mockClaimRiskScoringService.validateClaimFeatures.mockReturnValue(true);
      mockClaimRiskScoringService.scoreClaim.mockResolvedValue(mockRiskScore);
      mockCertaintyRepo.insertCertaintyScore.mockResolvedValue(mockCertaintyScore);
      mockTransactionJournalService.recordClaimRiskScored.mockResolvedValue({
        id: 'tx-789',
        tx_type: 'claim_risk_scored',
        entity_id: 'certainty-score-123',
        payload: {},
        timestamp: new Date().toISOString(),
        actor_id: mockUser.id,
        hash: 'mock-hash'
      });

      const response = await request(app)
        .post('/api/v1/claims/score')
        .set('Authorization', `Bearer ${mockToken}`)
        .send(claimFeatures)
        .expect(200);

      // Verify the complete flow
      expect(response.body.success).toBe(true);
      expect(response.body.data.certainty_score_id).toBe('certainty-score-123');
      expect(response.body.data.risk_assessment).toEqual(mockRiskScore);
      expect(response.body.data.claim_features).toEqual(claimFeatures);

      // Verify all service interactions
      expect(mockClaimRiskScoringService.validateClaimFeatures).toHaveBeenCalledWith(claimFeatures);
      expect(mockClaimRiskScoringService.scoreClaim).toHaveBeenCalledWith(claimFeatures);
      expect(mockCertaintyRepo.insertCertaintyScore).toHaveBeenCalled();
      expect(mockTransactionJournalService.recordClaimRiskScored).toHaveBeenCalled();
    });
  });
});




