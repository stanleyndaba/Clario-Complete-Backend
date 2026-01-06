/**
 * Unit Tests for Claim Risk Scoring Logic
 * Tests the ML-based claim risk assessment functionality
 */

import { claimRiskScoringService, ClaimRiskFeatures, ClaimRiskScore } from '../src/services/claimRiskScoringService';
import { ClaimRiskController } from '../src/api/controllers/claimRiskController';
import { Request, Response } from 'express';

// Mock the Python script execution
jest.mock('child_process', () => ({
  spawn: jest.fn()
}));

// Mock the CertaintyRepo and TransactionJournalService
jest.mock('../src/api/services/certaintyRepo', () => ({
  CertaintyRepo: {
    insertCertaintyScore: jest.fn()
  }
}));

jest.mock('../src/api/services/transactionJournalService', () => ({
  TransactionJournalService: {
    recordClaimRiskScored: jest.fn(),
    recordModelTraining: jest.fn()
  }
}));

describe('Claim Risk Scoring Service', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockJson: jest.Mock;
  let mockStatus: jest.Mock;

  beforeEach(() => {
    mockJson = jest.fn();
    mockStatus = jest.fn().mockReturnValue({ json: mockJson });
    
    mockRequest = {
      body: {},
      user: { id: 'test-user-id' }
    };
    
    mockResponse = {
      status: mockStatus,
      json: mockJson
    };
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('ClaimRiskScoringService', () => {
    describe('validateClaimFeatures', () => {
      it('should validate correct claim features', () => {
        const validFeatures: ClaimRiskFeatures = {
          discrepancy_type: 'missing_refund',
          discrepancy_size: 150.0,
          days_outstanding: 45,
          marketplace: 'amazon',
          historical_payout_rate: 0.75
        };

        const isValid = claimRiskScoringService.validateClaimFeatures(validFeatures);
        expect(isValid).toBe(true);
      });

      it('should reject invalid claim features', () => {
        const invalidFeatures = {
          discrepancy_type: 'missing_refund',
          discrepancy_size: -100, // Invalid: negative amount
          days_outstanding: 45,
          marketplace: 'amazon',
          historical_payout_rate: 1.5 // Invalid: > 1
        };

        const isValid = claimRiskScoringService.validateClaimFeatures(invalidFeatures);
        expect(isValid).toBe(false);
      });

      it('should reject missing required fields', () => {
        const incompleteFeatures = {
          discrepancy_type: 'missing_refund',
          discrepancy_size: 150.0,
          // Missing days_outstanding, marketplace, historical_payout_rate
        };

        const isValid = claimRiskScoringService.validateClaimFeatures(incompleteFeatures);
        expect(isValid).toBe(false);
      });
    });

    describe('getSampleClaim', () => {
      it('should return a valid sample claim', () => {
        const sampleClaim = claimRiskScoringService.getSampleClaim();
        
        expect(sampleClaim).toHaveProperty('discrepancy_type');
        expect(sampleClaim).toHaveProperty('discrepancy_size');
        expect(sampleClaim).toHaveProperty('days_outstanding');
        expect(sampleClaim).toHaveProperty('marketplace');
        expect(sampleClaim).toHaveProperty('historical_payout_rate');
        
        expect(typeof sampleClaim.discrepancy_type).toBe('string');
        expect(typeof sampleClaim.discrepancy_size).toBe('number');
        expect(typeof sampleClaim.days_outstanding).toBe('number');
        expect(typeof sampleClaim.marketplace).toBe('string');
        expect(typeof sampleClaim.historical_payout_rate).toBe('number');
      });
    });
  });

  describe('ClaimRiskController', () => {
    describe('scoreClaim', () => {
      it('should score a valid claim successfully', async () => {
        const validFeatures: ClaimRiskFeatures = {
          discrepancy_type: 'missing_refund',
          discrepancy_size: 150.0,
          days_outstanding: 45,
          marketplace: 'amazon',
          historical_payout_rate: 0.75
        };

        mockRequest.body = validFeatures;

        // Mock the service responses
        const mockRiskScore: ClaimRiskScore = {
          success_probability: 0.85,
          refund_timeline_days: 12.5,
          confidence_score: 0.8,
          risk_level: 'High',
          model_version: '1.0.0',
          features_used: Object.keys(validFeatures)
        };

        jest.spyOn(claimRiskScoringService, 'scoreClaim').mockResolvedValue(mockRiskScore);
        jest.spyOn(claimRiskScoringService, 'validateClaimFeatures').mockReturnValue(true);

        await ClaimRiskController.scoreClaim(mockRequest as Request, mockResponse as Response);

        expect(mockStatus).toHaveBeenCalledWith(200);
        expect(mockJson).toHaveBeenCalledWith({
          success: true,
          data: expect.objectContaining({
            certainty_score_id: expect.any(String),
            risk_assessment: mockRiskScore,
            claim_features: validFeatures,
            timestamp: expect.any(String)
          }),
          message: 'Claim risk assessment completed successfully'
        });
      });

      it('should return 400 for invalid claim features', async () => {
        const invalidFeatures = {
          discrepancy_type: 'missing_refund',
          discrepancy_size: -100, // Invalid
          days_outstanding: 45,
          marketplace: 'amazon',
          historical_payout_rate: 0.75
        };

        mockRequest.body = invalidFeatures;

        jest.spyOn(claimRiskScoringService, 'validateClaimFeatures').mockReturnValue(false);

        await ClaimRiskController.scoreClaim(mockRequest as Request, mockResponse as Response);

        expect(mockStatus).toHaveBeenCalledWith(400);
        expect(mockJson).toHaveBeenCalledWith({
          success: false,
          error: 'Invalid claim features. Required fields: discrepancy_type, discrepancy_size, days_outstanding, marketplace, historical_payout_rate'
        });
      });

      it('should return 401 for unauthenticated requests', async () => {
        mockRequest.user = undefined;

        await ClaimRiskController.scoreClaim(mockRequest as Request, mockResponse as Response);

        expect(mockStatus).toHaveBeenCalledWith(401);
        expect(mockJson).toHaveBeenCalledWith({
          success: false,
          error: 'Authentication required'
        });
      });

      it('should handle service errors gracefully', async () => {
        const validFeatures: ClaimRiskFeatures = {
          discrepancy_type: 'missing_refund',
          discrepancy_size: 150.0,
          days_outstanding: 45,
          marketplace: 'amazon',
          historical_payout_rate: 0.75
        };

        mockRequest.body = validFeatures;

        jest.spyOn(claimRiskScoringService, 'validateClaimFeatures').mockReturnValue(true);
        jest.spyOn(claimRiskScoringService, 'scoreClaim').mockRejectedValue(new Error('ML model error'));

        await ClaimRiskController.scoreClaim(mockRequest as Request, mockResponse as Response);

        expect(mockStatus).toHaveBeenCalledWith(500);
        expect(mockJson).toHaveBeenCalledWith({
          success: false,
          error: 'Failed to score claim risk',
          details: 'ML model error'
        });
      });
    });

    describe('trainModels', () => {
      it('should train models successfully', async () => {
        const trainingParams = { n_samples: 5000 };
        mockRequest.body = trainingParams;

        const mockMetrics = {
          success_accuracy: 0.85,
          success_auc: 0.82,
          timeline_rmse: 3.2,
          timeline_r2: 0.78
        };

        jest.spyOn(claimRiskScoringService, 'trainModels').mockResolvedValue(mockMetrics);

        await ClaimRiskController.trainModels(mockRequest as Request, mockResponse as Response);

        expect(mockStatus).toHaveBeenCalledWith(200);
        expect(mockJson).toHaveBeenCalledWith({
          success: true,
          data: {
            training_metrics: mockMetrics,
            samples_used: 5000,
            timestamp: expect.any(String)
          },
          message: 'ML models trained successfully'
        });
      });

      it('should use default n_samples when not provided', async () => {
        mockRequest.body = {};

        const mockMetrics = {
          success_accuracy: 0.85,
          success_auc: 0.82,
          timeline_rmse: 3.2,
          timeline_r2: 0.78
        };

        jest.spyOn(claimRiskScoringService, 'trainModels').mockResolvedValue(mockMetrics);

        await ClaimRiskController.trainModels(mockRequest as Request, mockResponse as Response);

        expect(claimRiskScoringService.trainModels).toHaveBeenCalledWith(10000);
      });
    });

    describe('getModelInfo', () => {
      it('should return model information successfully', async () => {
        const mockInfo = {
          is_trained: true,
          models_dir: '/path/to/models',
          success_model_type: 'LogisticRegression',
          timeline_model_type: 'LinearRegression',
          categorical_features: ['discrepancy_type', 'marketplace'],
          numerical_features: ['discrepancy_size', 'days_outstanding', 'historical_payout_rate']
        };

        jest.spyOn(claimRiskScoringService, 'getModelInfo').mockResolvedValue(mockInfo);

        await ClaimRiskController.getModelInfo(mockRequest as Request, mockResponse as Response);

        expect(mockStatus).toHaveBeenCalledWith(200);
        expect(mockJson).toHaveBeenCalledWith({
          success: true,
          data: mockInfo,
          message: 'Model information retrieved successfully'
        });
      });
    });

    describe('checkEnvironment', () => {
      it('should return environment status successfully', async () => {
        jest.spyOn(claimRiskScoringService, 'checkPythonEnvironment').mockResolvedValue(true);

        await ClaimRiskController.checkEnvironment(mockRequest as Request, mockResponse as Response);

        expect(mockStatus).toHaveBeenCalledWith(200);
        expect(mockJson).toHaveBeenCalledWith({
          success: true,
          data: {
            python_available: true,
            timestamp: expect.any(String)
          },
          message: 'Python environment is ready'
        });
      });

      it('should handle unavailable environment', async () => {
        jest.spyOn(claimRiskScoringService, 'checkPythonEnvironment').mockResolvedValue(false);

        await ClaimRiskController.checkEnvironment(mockRequest as Request, mockResponse as Response);

        expect(mockStatus).toHaveBeenCalledWith(200);
        expect(mockJson).toHaveBeenCalledWith({
          success: true,
          data: {
            python_available: false,
            timestamp: expect.any(String)
          },
          message: 'Python environment is not available'
        });
      });
    });

    describe('getSampleClaim', () => {
      it('should return sample claim successfully', async () => {
        const sampleClaim = claimRiskScoringService.getSampleClaim();

        await ClaimRiskController.getSampleClaim(mockRequest as Request, mockResponse as Response);

        expect(mockStatus).toHaveBeenCalledWith(200);
        expect(mockJson).toHaveBeenCalledWith({
          success: true,
          data: {
            sample_claim: sampleClaim,
            description: 'Sample claim features for testing the risk scoring API'
          },
          message: 'Sample claim retrieved successfully'
        });
      });
    });

    describe('batchScoreClaims', () => {
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

        mockRequest.body = { claims };

        const mockRiskScore: ClaimRiskScore = {
          success_probability: 0.85,
          refund_timeline_days: 12.5,
          confidence_score: 0.8,
          risk_level: 'High',
          model_version: '1.0.0',
          features_used: ['discrepancy_type', 'discrepancy_size', 'days_outstanding', 'marketplace', 'historical_payout_rate']
        };

        jest.spyOn(claimRiskScoringService, 'validateClaimFeatures').mockReturnValue(true);
        jest.spyOn(claimRiskScoringService, 'scoreClaim').mockResolvedValue(mockRiskScore);

        await ClaimRiskController.batchScoreClaims(mockRequest as Request, mockResponse as Response);

        expect(mockStatus).toHaveBeenCalledWith(200);
        expect(mockJson).toHaveBeenCalledWith({
          success: true,
          data: {
            total_claims: 2,
            successful_scores: 2,
            failed_scores: 0,
            results: expect.arrayContaining([
              expect.objectContaining({
                index: 0,
                claim_features: claims[0],
                risk_assessment: mockRiskScore
              }),
              expect.objectContaining({
                index: 1,
                claim_features: claims[1],
                risk_assessment: mockRiskScore
              })
            ]),
            errors: []
          },
          message: 'Batch scoring completed. 2 successful, 0 failed.'
        });
      });

      it('should handle invalid claims in batch', async () => {
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

        mockRequest.body = { claims };

        jest.spyOn(claimRiskScoringService, 'validateClaimFeatures')
          .mockReturnValueOnce(true)  // First claim valid
          .mockReturnValueOnce(false); // Second claim invalid

        const mockRiskScore: ClaimRiskScore = {
          success_probability: 0.85,
          refund_timeline_days: 12.5,
          confidence_score: 0.8,
          risk_level: 'High',
          model_version: '1.0.0',
          features_used: ['discrepancy_type', 'discrepancy_size', 'days_outstanding', 'marketplace', 'historical_payout_rate']
        };

        jest.spyOn(claimRiskScoringService, 'scoreClaim').mockResolvedValue(mockRiskScore);

        await ClaimRiskController.batchScoreClaims(mockRequest as Request, mockResponse as Response);

        expect(mockStatus).toHaveBeenCalledWith(200);
        expect(mockJson).toHaveBeenCalledWith({
          success: true,
          data: {
            total_claims: 2,
            successful_scores: 1,
            failed_scores: 1,
            results: expect.arrayContaining([
              expect.objectContaining({
                index: 0,
                claim_features: claims[0],
                risk_assessment: mockRiskScore
              })
            ]),
            errors: expect.arrayContaining([
              expect.objectContaining({
                index: 1,
                error: 'Invalid claim features',
                claim: claims[1]
              })
            ])
          },
          message: 'Batch scoring completed. 1 successful, 1 failed.'
        });
      });

      it('should reject empty claims array', async () => {
        mockRequest.body = { claims: [] };

        await ClaimRiskController.batchScoreClaims(mockRequest as Request, mockResponse as Response);

        expect(mockStatus).toHaveBeenCalledWith(400);
        expect(mockJson).toHaveBeenCalledWith({
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

        mockRequest.body = { claims };

        await ClaimRiskController.batchScoreClaims(mockRequest as Request, mockResponse as Response);

        expect(mockStatus).toHaveBeenCalledWith(400);
        expect(mockJson).toHaveBeenCalledWith({
          success: false,
          error: 'Maximum 100 claims can be scored in a single batch'
        });
      });
    });
  });
});




