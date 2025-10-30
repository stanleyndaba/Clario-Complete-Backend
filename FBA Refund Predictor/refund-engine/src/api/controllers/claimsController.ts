import { Request, Response } from 'express';
import { ClaimsService, CreateClaimRequest, UpdateClaimRequest, ClaimsQueryParams } from '../services/claimsService';
import { flagClaimFromInvoiceText, getProofBundleWithLinks } from '../services/evidenceEngine';
import { CertaintyEngine, ClaimPayload } from '../services/certaintyEngine';
import { CertaintyRepo } from '../services/certaintyRepo';
import { TransactionJournalService } from '../services/transactionJournalService';

export class ClaimsController {
  /**
   * Create a new claim
   * POST /api/v1/claims
   */
  static async createClaim(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const claimData: CreateClaimRequest = req.body;
      
      // Validate required fields
      if (!claimData.case_number || !claimData.claim_amount || !claimData.product_category) {
        res.status(400).json({ 
          error: 'Missing required fields',
          message: 'case_number, claim_amount, and product_category are required'
        });
        return;
      }

      const claim = await ClaimsService.createClaim(req.user.id, claimData);

      // Seed a submission record for Amazon worker if enabled
      try {
        if (process.env.ENABLE_AMAZON_SUBMISSION === 'true') {
          await ClaimsService.createSubmissionRecord(req.user.id, claim.id, 'amazon');
        }
      } catch (e) {
        console.error('Failed to create submission record:', e);
      }
      
      res.status(201).json({
        success: true,
        data: claim,
        message: 'Claim created successfully'
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'Case number already exists') {
        res.status(409).json({
          error: 'Duplicate case number',
          message: 'A claim with this case number already exists'
        });
        return;
      }

      console.error('Error creating claim:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to create claim'
      });
    }
  }

  /**
   * Get all claims with pagination and filtering
   * GET /api/v1/claims
   */
  static async getClaims(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const queryParams: ClaimsQueryParams = {
        status: req.query.status as string,
        product_category: req.query.product_category as string,
        limit: req.query.limit ? parseInt(req.query.limit as string) : 10,
        offset: req.query.offset ? parseInt(req.query.offset as string) : 0,
        sort_by: req.query.sort_by as string || 'created_at',
        sort_order: (req.query.sort_order as 'ASC' | 'DESC') || 'DESC'
      };

      const result = await ClaimsService.getClaims(req.user.id, queryParams);
      
      res.status(200).json({
        success: true,
        data: result.claims,
        pagination: {
          total: result.total,
          limit: queryParams.limit,
          offset: queryParams.offset,
          has_more: result.total > (queryParams.offset || 0) + (queryParams.limit || 10)
        }
      });
    } catch (error) {
      console.error('Error getting claims:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to retrieve claims'
      });
    }
  }

  /**
   * Get a specific claim by ID
   * GET /api/v1/claims/:id
   */
  static async getClaimById(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const { id } = req.params;
      const claim = await ClaimsService.getClaimById(req.user.id, id);

      if (!claim) {
        res.status(404).json({
          error: 'Claim not found',
          message: 'The specified claim does not exist or you do not have access to it'
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: claim
      });
    } catch (error) {
      console.error('Error getting claim by ID:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to retrieve claim'
      });
    }
  }

  /**
   * Get a specific claim by case number
   * GET /api/v1/claims/case/:caseNumber
   */
  static async getClaimByCaseNumber(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const { caseNumber } = req.params;
      const claim = await ClaimsService.getClaimByCaseNumber(req.user.id, caseNumber);

      if (!claim) {
        res.status(404).json({
          error: 'Claim not found',
          message: 'The specified claim does not exist or you do not have access to it'
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: claim
      });
    } catch (error) {
      console.error('Error getting claim by case number:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to retrieve claim'
      });
    }
  }

  /**
   * Update a claim
   * PUT /api/v1/claims/:id
   */
  static async updateClaim(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const { id } = req.params;
      const updateData: UpdateClaimRequest = req.body;

      const prev = await ClaimsService.getClaimById(req.user.id, id);
      const updatedClaim = await ClaimsService.updateClaim(req.user.id, id, updateData);

      if (!updatedClaim) {
        res.status(404).json({
          error: 'Claim not found',
          message: 'The specified claim does not exist or you do not have access to it'
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: updatedClaim,
        message: 'Claim updated successfully'
      });

      // If status transitioned to paid, emit billing webhook to stripe-payments and create billing audit
      try {
        const prevStatus = prev?.status;
        const newStatus = updatedClaim?.status;
        if (newStatus && (newStatus as any) === 'paid' && prevStatus !== newStatus) {
          const stripeUrl = process.env.STRIPE_PAYMENTS_URL;
          if (stripeUrl) {
            const idempotencyKey = `claim-${id}-status-${newStatus}`;
            await fetch(`${stripeUrl}/api/v1/stripe/charge-commission`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': req.headers['authorization'] || '',
                'Idempotency-Key': idempotencyKey,
              },
              body: JSON.stringify({
                userId: req.user.id,
                claimId: id,
                amountRecoveredCents: Math.round((updatedClaim?.claim_amount || 0) * 100),
                currency: 'usd',
              }),
            });

            // Insert billing audit row
            await ClaimsService.recordBillingEvent(req.user.id, id, 'commission_charged', Math.round((updatedClaim?.claim_amount || 0) * 100), 'usd', idempotencyKey);
          }

          // Emit paid notification to Notifications service (optional)
          try {
            const notificationsUrl = process.env.NOTIFICATIONS_URL;
            if (notificationsUrl) {
              await fetch(`${notificationsUrl}/api/notifications`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': req.headers['authorization'] || '',
                },
                body: JSON.stringify({
                  type: 'payment_processed',
                  title: 'Claim Paid',
                  message: `Your reimbursement claim ${id} has been paid.`,
                  priority: 'normal',
                  channel: 'both',
                  immediate: true,
                  payload: {
                    claim_id: id,
                    amount_cents: Math.round((updatedClaim?.claim_amount || 0) * 100),
                    currency: 'usd',
                  }
                })
              });
            }
          } catch (e) {
            console.error('Failed to send paid notification:', e);
          }
        }
      } catch (e) {
        console.error('Failed to notify stripe-payments for commission:', e);
      }
    } catch (error) {
      console.error('Error updating claim:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to update claim'
      });
    }
  }

  /**
   * Delete a claim
   * DELETE /api/v1/claims/:id
   */
  static async deleteClaim(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const { id } = req.params;
      const deleted = await ClaimsService.deleteClaim(req.user.id, id);

      if (!deleted) {
        res.status(404).json({
          error: 'Claim not found',
          message: 'The specified claim does not exist or you do not have access to it'
        });
        return;
      }

      res.status(200).json({
        success: true,
        message: 'Claim deleted successfully'
      });
    } catch (error) {
      console.error('Error deleting claim:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to delete claim'
      });
    }
  }

  /**
   * Get claims statistics
   * GET /api/v1/claims/stats
   */
  static async getClaimsStats(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const stats = await ClaimsService.getClaimsStats(req.user.id);
      
      res.status(200).json({
        success: true,
        data: stats
      });
    } catch (error) {
      console.error('Error getting claims stats:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to retrieve claims statistics'
      });
    }
  }

  /**
   * Search claims
   * GET /api/v1/claims/search
   */
  static async searchClaims(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const { q, limit } = req.query;
      
      if (!q || typeof q !== 'string') {
        res.status(400).json({
          error: 'Search query required',
          message: 'Please provide a search term in the "q" parameter'
        });
        return;
      }

      const searchLimit = limit ? parseInt(limit as string) : 10;
      const claims = await ClaimsService.searchClaims(req.user.id, q, searchLimit);
      
      res.status(200).json({
        success: true,
        data: claims,
        search: {
          query: q,
          results_count: claims.length
        }
      });
    } catch (error) {
      console.error('Error searching claims:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to search claims'
      });
    }
  }

  /**
   * Flag a claim from invoice text (MVP Evidence & Value Engine trigger)
   * POST /api/v1/claims/flag
   * body: { case_number, claim_amount, invoice_text, actor_id }
   */
  static async flagClaim(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const { case_number, claim_amount, invoice_text, actor_id } = req.body || {};
      if (!case_number || !claim_amount || !invoice_text) {
        res.status(400).json({ error: 'Missing required fields', message: 'case_number, claim_amount, invoice_text' });
        return;
      }

      const actor = actor_id || req.user.id;
      const { claim, proof } = await flagClaimFromInvoiceText(req.user.id, actor, case_number, Number(claim_amount), invoice_text);

      // Now integrate with Certainty Engine
      try {
        const claimPayload: ClaimPayload = {
          claim_id: claim.id,
          actor_id: actor,
          invoice_text,
          proof_bundle_id: proof.id,
          claim_amount: Number(claim_amount),
          anomaly_score: claim.anomaly_score || 0.5,
          claim_type: 'invoice_text'
        };

        // Generate certainty score
        const scoringResult = await CertaintyEngine.scoreClaim(claimPayload);
        
        // Store certainty score
        const certaintyScore = await CertaintyRepo.insertCertaintyScore({
          claim_id: claim.id,
          refund_probability: scoringResult.refund_probability,
          risk_level: scoringResult.risk_level
        });

        // Log the integrated transaction
        await TransactionJournalService.recordClaimFlaggedWithCertainty(
          claim.id,
          proof.id,
          certaintyScore.id,
          actor
        );

        console.log('🔍 [ClaimsController] Claim flagged with certainty score:', {
          claim_id: claim.id,
          proof_bundle_id: proof.id,
          certainty_score_id: certaintyScore.id,
          refund_probability: scoringResult.refund_probability,
          risk_level: scoringResult.risk_level
        });

        res.status(201).json({ 
          success: true, 
          data: { 
            claim: { ...claim, certainty_score_id: certaintyScore.id },
            proof,
            certainty_score: certaintyScore,
            scoring_details: scoringResult
          } 
        });
      } catch (certaintyError) {
        console.error('Error in certainty scoring:', certaintyError);
        // Still return the flagged claim even if certainty scoring fails
        res.status(201).json({ 
          success: true, 
          data: { claim, proof },
          warning: 'Claim flagged but certainty scoring failed'
        });
      }
    } catch (error) {
      console.error('Error flagging claim from invoice text:', error);
      res.status(500).json({ error: 'Internal server error', message: 'Failed to flag claim' });
    }
  }

  /**
   * Get proof bundle + evidence link for audit
   * GET /api/v1/proofs/:id
   */
  static async getProof(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const { id } = req.params;
      const data = await getProofBundleWithLinks(id);
      if (!data) {
        res.status(404).json({ error: 'Not found' });
        return;
      }
      res.status(200).json({ success: true, data });
    } catch (error) {
      console.error('Error getting proof bundle:', error);
      res.status(500).json({ error: 'Internal server error', message: 'Failed to fetch proof' });
    }
  }

  /**
   * Unified endpoint: Flag claim + generate certainty score in one shot
   * POST /api/v1/claims/flag+score
   * body: { case_number, claim_amount, invoice_text, actor_id }
   * 
   * This endpoint provides a single API call for the complete flow:
   * 1. Flag claim from invoice text
   * 2. Generate certainty score
   * 3. Store both in database
   * 4. Log transaction for audit
   */
  static async flagClaimWithCertainty(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const { case_number, claim_amount, invoice_text, actor_id } = req.body || {};
      if (!case_number || !claim_amount || !invoice_text) {
        res.status(400).json({ 
          error: 'Missing required fields', 
          message: 'case_number, claim_amount, and invoice_text are required' 
        });
        return;
      }

      const actor = actor_id || req.user.id;
      
      // Step 1: Flag claim using Evidence Engine
      const { claim, proof } = await flagClaimFromInvoiceText(req.user.id, actor, case_number, Number(claim_amount), invoice_text);

      // Step 2: Generate certainty score
      const claimPayload: ClaimPayload = {
        claim_id: claim.id,
        actor_id: actor,
        invoice_text,
        proof_bundle_id: proof.id,
        claim_amount: Number(claim_amount),
        anomaly_score: claim.anomaly_score || 0.5,
        claim_type: 'invoice_text'
      };

      const scoringResult = await CertaintyEngine.scoreClaim(claimPayload);
      
      // Step 3: Store certainty score
      const certaintyScore = await CertaintyRepo.insertCertaintyScore({
        claim_id: claim.id,
        refund_probability: scoringResult.refund_probability,
        risk_level: scoringResult.risk_level
      });

      // Step 4: Log integrated transaction
      const transactionLog = await TransactionJournalService.recordClaimFlaggedWithCertainty(
        claim.id,
        proof.id,
        certaintyScore.id,
        actor
      );

      console.log('🚀 [ClaimsController] Unified flag+score completed:', {
        claim_id: claim.id,
        proof_bundle_id: proof.id,
        certainty_score_id: certaintyScore.id,
        transaction_id: transactionLog.id,
        refund_probability: scoringResult.refund_probability,
        risk_level: scoringResult.risk_level
      });

      // Step 5: Return unified response
      res.status(201).json({
        success: true,
        data: {
          claim: {
            ...claim,
            proof_bundle_id: proof.id,
            certainty_score_id: certaintyScore.id
          },
          proof_bundle: proof,
          certainty_score: certaintyScore,
          scoring_details: scoringResult,
          transaction_log: {
            id: transactionLog.id,
            hash: transactionLog.hash.substring(0, 8) + '...',
            timestamp: transactionLog.timestamp
          }
        },
        message: 'Claim flagged and certainty scored successfully'
      });

    } catch (error) {
      console.error('Error in unified flag+score flow:', error);
      res.status(500).json({ 
        error: 'Internal server error', 
        message: 'Failed to complete flag+score flow' 
      });
    }
  }
} 

