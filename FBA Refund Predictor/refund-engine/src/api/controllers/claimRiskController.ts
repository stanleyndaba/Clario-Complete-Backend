/**
 * Claim Risk Scoring Controller
 * Handles API endpoints for claim risk scoring using ML models
 */

import { Request, Response } from 'express';
import { claimRiskScoringService, ClaimRiskFeatures } from '../../services/claimRiskScoringService';
import { CertaintyRepo } from './certaintyRepo';
import { TransactionJournalService } from './transactionJournalService';

export class ClaimRiskController {
  /**
   * Score a claim for risk assessment
   * POST /api/v1/claims/score
   */
  static async scoreClaim(req: Request, res: Response): Promise<void> {
    try {
      const { user } = req as any;
      if (!user || !user.id) {
        res.status(401).json({ 
          success: false, 
          error: 'Authentication required' 
        });
        return;
      }

      // Validate request body
      const features = req.body;
      
      if (!claimRiskScoringService.validateClaimFeatures(features)) {
        res.status(400).json({
          success: false,
          error: 'Invalid claim features. Required fields: discrepancy_type, discrepancy_size, days_outstanding, marketplace, historical_payout_rate'
        });
        return;
      }

      // Score the claim using ML models
      const riskScore = await claimRiskScoringService.scoreClaim(features);

      // Create certainty score record in database
      const certaintyScore = await CertaintyRepo.insertCertaintyScore({
        claim_id: req.body.claim_id || `temp-${Date.now()}`,
        refund_probability: riskScore.success_probability,
        risk_level: riskScore.risk_level,
        confidence_score: riskScore.confidence_score,
        refund_timeline_days: riskScore.refund_timeline_days,
        model_version: riskScore.model_version,
        features_used: riskScore.features_used
      });

      // Log transaction
      await TransactionJournalService.recordClaimRiskScored(
        certaintyScore.id,
        user.id,
        features,
        riskScore
      );

      res.status(200).json({
        success: true,
        data: {
          certainty_score_id: certaintyScore.id,
          risk_assessment: riskScore,
          claim_features: features,
          timestamp: new Date().toISOString()
        },
        message: 'Claim risk assessment completed successfully'
      });

    } catch (error) {
      console.error('Error in scoreClaim:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to score claim risk',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Train the ML models
   * POST /api/v1/claims/train-models
   */
  static async trainModels(req: Request, res: Response): Promise<void> {
    try {
      const { user } = req as any;
      if (!user || !user.id) {
        res.status(401).json({ 
          success: false, 
          error: 'Authentication required' 
        });
        return;
      }

      const { n_samples = 10000 } = req.body;

      // Train the models
      const metrics = await claimRiskScoringService.trainModels(n_samples);

      // Log training event
      await TransactionJournalService.recordModelTraining(
        user.id,
        n_samples,
        metrics
      );

      res.status(200).json({
        success: true,
        data: {
          training_metrics: metrics,
          samples_used: n_samples,
          timestamp: new Date().toISOString()
        },
        message: 'ML models trained successfully'
      });

    } catch (error) {
      console.error('Error in trainModels:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to train models',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Get model information
   * GET /api/v1/claims/model-info
   */
  static async getModelInfo(req: Request, res: Response): Promise<void> {
    try {
      const { user } = req as any;
      if (!user || !user.id) {
        res.status(401).json({ 
          success: false, 
          error: 'Authentication required' 
        });
        return;
      }

      const modelInfo = await claimRiskScoringService.getModelInfo();

      res.status(200).json({
        success: true,
        data: modelInfo,
        message: 'Model information retrieved successfully'
      });

    } catch (error) {
      console.error('Error in getModelInfo:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get model information',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Check Python environment
   * GET /api/v1/claims/check-environment
   */
  static async checkEnvironment(req: Request, res: Response): Promise<void> {
    try {
      const { user } = req as any;
      if (!user || !user.id) {
        res.status(401).json({ 
          success: false, 
          error: 'Authentication required' 
        });
        return;
      }

      const isAvailable = await claimRiskScoringService.checkPythonEnvironment();

      res.status(200).json({
        success: true,
        data: {
          python_available: isAvailable,
          timestamp: new Date().toISOString()
        },
        message: isAvailable ? 'Python environment is ready' : 'Python environment is not available'
      });

    } catch (error) {
      console.error('Error in checkEnvironment:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to check environment',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Get sample claim for testing
   * GET /api/v1/claims/sample
   */
  static async getSampleClaim(req: Request, res: Response): Promise<void> {
    try {
      const { user } = req as any;
      if (!user || !user.id) {
        res.status(401).json({ 
          success: false, 
          error: 'Authentication required' 
        });
        return;
      }

      const sampleClaim = claimRiskScoringService.getSampleClaim();

      res.status(200).json({
        success: true,
        data: {
          sample_claim: sampleClaim,
          description: 'Sample claim features for testing the risk scoring API'
        },
        message: 'Sample claim retrieved successfully'
      });

    } catch (error) {
      console.error('Error in getSampleClaim:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get sample claim',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Batch score multiple claims
   * POST /api/v1/claims/batch-score
   */
  static async batchScoreClaims(req: Request, res: Response): Promise<void> {
    try {
      const { user } = req as any;
      if (!user || !user.id) {
        res.status(401).json({ 
          success: false, 
          error: 'Authentication required' 
        });
        return;
      }

      const { claims } = req.body;

      if (!Array.isArray(claims) || claims.length === 0) {
        res.status(400).json({
          success: false,
          error: 'Claims array is required and must not be empty'
        });
        return;
      }

      if (claims.length > 100) {
        res.status(400).json({
          success: false,
          error: 'Maximum 100 claims can be scored in a single batch'
        });
        return;
      }

      const results = [];
      const errors = [];

      // Process each claim
      for (let i = 0; i < claims.length; i++) {
        try {
          const claim = claims[i];
          
          if (!claimRiskScoringService.validateClaimFeatures(claim)) {
            errors.push({
              index: i,
              error: 'Invalid claim features',
              claim: claim
            });
            continue;
          }

          const riskScore = await claimRiskScoringService.scoreClaim(claim);
          
          results.push({
            index: i,
            claim_features: claim,
            risk_assessment: riskScore,
            timestamp: new Date().toISOString()
          });

        } catch (error) {
          errors.push({
            index: i,
            error: error instanceof Error ? error.message : 'Unknown error',
            claim: claims[i]
          });
        }
      }

      res.status(200).json({
        success: true,
        data: {
          total_claims: claims.length,
          successful_scores: results.length,
          failed_scores: errors.length,
          results: results,
          errors: errors
        },
        message: `Batch scoring completed. ${results.length} successful, ${errors.length} failed.`
      });

    } catch (error) {
      console.error('Error in batchScoreClaims:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to batch score claims',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
}




