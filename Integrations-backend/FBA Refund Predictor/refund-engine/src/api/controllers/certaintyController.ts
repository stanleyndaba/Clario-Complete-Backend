import { Request, Response } from 'express';
import { CertaintyEngine, ClaimPayload, ScoringResult } from '../services/certaintyEngine';
import { CertaintyRepo } from '../services/certaintyRepo';

export class CertaintyController {
  
  /**
   * Score a flagged claim and persist the result
   * POST /api/v1/certainty/score
   */
  static async scoreClaim(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, error: 'Authentication required' });
        return;
      }

      const { claim_id, actor_id, invoice_text, proof_bundle_id, claim_amount, anomaly_score, claim_type } = req.body || {};

      // Validate required fields
      if (!claim_id || !actor_id || !invoice_text || !proof_bundle_id) {
        res.status(400).json({
          success: false,
          error: 'Missing required fields',
          message: 'claim_id, actor_id, invoice_text, and proof_bundle_id are required'
        });
        return;
      }

      // Create claim payload
      const claimPayload: ClaimPayload = {
        claim_id, actor_id, invoice_text, proof_bundle_id, claim_amount, anomaly_score, claim_type
      };

      console.log('🎯 [CertaintyController] Processing claim for scoring:', { claim_id, actor_id });

      // Generate certainty score using the engine
      const scoringResult: ScoringResult = await CertaintyEngine.scoreClaim(claimPayload);

      // Persist the certainty score to database
      const certaintyScore = await CertaintyRepo.insertCertaintyScore({
        claim_id,
        refund_probability: scoringResult.refund_probability,
        risk_level: scoringResult.risk_level
      });

      // Return success response
      res.status(201).json({
        success: true,
        data: {
          certainty_score: certaintyScore,
          scoring_details: scoringResult
        },
        message: 'Claim scored successfully'
      });

    } catch (error) {
      console.error('❌ [CertaintyController] Error scoring claim:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Failed to score claim'
      });
    }
  }

  /**
   * Get certainty scores for a specific claim
   * GET /api/v1/certainty/scores/:claim_id
   */
  static async getCertaintyScores(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, error: 'Authentication required' });
        return;
      }

      const { claim_id } = req.params;
      if (!claim_id) {
        res.status(400).json({ success: false, error: 'Missing claim ID' });
        return;
      }

      const certaintyScores = await CertaintyRepo.getCertaintyScoresByClaim(claim_id);

      res.status(200).json({
        success: true,
        data: { claim_id, certainty_scores: certaintyScores, count: certaintyScores.length }
      });

    } catch (error) {
      console.error('❌ [CertaintyController] Error retrieving certainty scores:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Failed to retrieve certainty scores'
      });
    }
  }

  /**
   * Get the latest certainty score for a claim
   * GET /api/v1/certainty/scores/:claim_id/latest
   */
  static async getLatestCertaintyScore(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, error: 'Authentication required' });
        return;
      }

      const { claim_id } = req.params;
      if (!claim_id) {
        res.status(400).json({ success: false, error: 'Missing claim ID' });
        return;
      }

      const latestScore = await CertaintyRepo.getLatestCertaintyScore(claim_id);

      if (!latestScore) {
        res.status(404).json({
          success: false,
          error: 'No certainty score found',
          message: `No certainty score exists for claim ${claim_id}`
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: { claim_id, latest_certainty_score: latestScore }
      });

    } catch (error) {
      console.error('❌ [CertaintyController] Error retrieving latest certainty score:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Failed to retrieve latest certainty score'
      });
    }
  }

  /**
   * Get certainty score statistics
   * GET /api/v1/certainty/stats
   */
  static async getCertaintyStats(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, error: 'Authentication required' });
        return;
      }

      const stats = await CertaintyRepo.getCertaintyScoreStats();

      res.status(200).json({
        success: true,
        data: stats
      });

    } catch (error) {
      console.error('❌ [CertaintyController] Error retrieving certainty statistics:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Failed to retrieve certainty statistics'
      });
    }
  }
}
