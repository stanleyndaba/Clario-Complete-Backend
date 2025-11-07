import { Router, Request, Response } from 'express';
import OrchestrationJobManager from '../jobs/orchestrationJob';
import logger from '../utils/logger';

const router = Router();

/**
 * Valid phase numbers for the 7-phase Clario workflow
 */
type PhaseNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/**
 * Validate phase number is between 1-7
 */
function isValidPhaseNumber(num: number): num is PhaseNumber {
  return Number.isInteger(num) && num >= 1 && num <= 7;
}

/**
 * POST /api/v1/workflow/phase/:phaseNumber
 * Trigger a specific phase of the 7-phase workflow
 * Called by Python services to trigger orchestrator phases
 * 
 * @param phaseNumber - Must be 1-7 (TypeScript enforces at compile time, runtime validates)
 */
router.post('/phase/:phaseNumber', async (req: Request, res: Response) => {
  try {
    const phaseNumberRaw = parseInt(req.params.phaseNumber, 10);
    
    // Validate phase number
    if (isNaN(phaseNumberRaw) || !isValidPhaseNumber(phaseNumberRaw)) {
      return res.status(400).json({ 
        success: false, 
        error: `Invalid phase number: ${req.params.phaseNumber}. Must be 1-7.` 
      });
    }
    
    const phaseNumber: PhaseNumber = phaseNumberRaw;
    const { user_id, sync_id, ...metadata } = req.body;

    if (!user_id) {
      return res.status(400).json({ 
        success: false, 
        error: 'user_id is required' 
      });
    }

    logger.info(`Workflow phase ${phaseNumber} triggered`, { user_id, sync_id, metadata });

    switch (phaseNumber) {
      case 1: // OAuth Completion
        await OrchestrationJobManager.triggerPhase1_OAuthCompletion(
          user_id,
          metadata.seller_id || user_id,
          sync_id
        );
        break;

      case 2: // Sync Completion
        if (!sync_id) {
          return res.status(400).json({ 
            success: false, 
            error: 'sync_id is required for Phase 2' 
          });
        }
        await OrchestrationJobManager.triggerPhase2_SyncCompletion(
          user_id,
          sync_id,
          metadata.orders_count || 0,
          metadata.inventory_items || 0
        );
        break;

      case 3: // Detection Completion
        if (!sync_id) {
          return res.status(400).json({ 
            success: false, 
            error: 'sync_id is required for Phase 3' 
          });
        }
        await OrchestrationJobManager.triggerPhase3_DetectionCompletion(
          user_id,
          sync_id,
          metadata.claims || metadata.claims_found || []
        );
        break;

      case 4: // Evidence Matching
        if (!sync_id) {
          return res.status(400).json({ 
            success: false, 
            error: 'sync_id is required for Phase 4' 
          });
        }
        await OrchestrationJobManager.triggerPhase4_EvidenceMatching(
          user_id,
          sync_id,
          metadata.matches || metadata.matching_results || []
        );
        break;

      case 5: // Claim Submission
        if (!metadata.claim_id) {
          return res.status(400).json({ 
            success: false, 
            error: 'claim_id is required for Phase 5' 
          });
        }
        await OrchestrationJobManager.triggerPhase5_ClaimSubmission(
          user_id,
          metadata.claim_id,
          metadata.amazon_case_id,
          sync_id
        );
        break;

      case 6: // Claim Rejection
        if (!metadata.claim_id || !metadata.rejection_reason) {
          return res.status(400).json({ 
            success: false, 
            error: 'claim_id and rejection_reason are required for Phase 6' 
          });
        }
        await OrchestrationJobManager.triggerPhase6_ClaimRejection(
          user_id,
          metadata.claim_id,
          metadata.rejection_reason || metadata.reason,
          metadata.amazon_case_id || metadata.case_id,
          sync_id
        );
        break;

      case 7: // Payout Received
        if (!metadata.claim_id || !metadata.amount) {
          return res.status(400).json({ 
            success: false, 
            error: 'claim_id and amount are required for Phase 7' 
          });
        }
        await OrchestrationJobManager.triggerPhase7_PayoutReceived(
          user_id,
          metadata.claim_id,
          metadata.amount,
          metadata.amazon_case_id || metadata.case_id,
          sync_id
        );
        break;

      default:
        return res.status(400).json({ 
          success: false, 
          error: `Invalid phase number: ${phaseNumber}. Must be 1-7.` 
        });
    }

    return res.json({ 
      success: true, 
      phase: phaseNumber,
      message: `Phase ${phaseNumber} orchestration triggered` 
    });

  } catch (error: any) {
    logger.error('Error triggering workflow phase', { 
      error: error.message, 
      phase: req.params.phaseNumber,
      body: req.body 
    });
    return res.status(500).json({ 
      success: false, 
      error: error.message || 'Internal server error' 
    });
  }
});

export default router;

