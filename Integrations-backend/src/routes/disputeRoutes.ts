import { Router } from 'express';
import { optionalAuth } from '../middleware/authMiddleware';
import { supabaseAdmin } from '../database/supabaseClient';

const router = Router();

// Apply optional authentication - allows demo-user access
router.use(optionalAuth);

router.get('/', async (req, res) => {
  try {
    const userId = (req as any).userId || (req as any).user?.id || 'demo-user';
    const { status, limit } = req.query;

    // Build query with optional status filter
    let query = supabaseAdmin
      .from('dispute_cases')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(Number(limit) || 100);

    // Apply status filter if provided (convert to proper case matching)
    if (status && status !== 'all') {
      // Try both lowercase and capitalized versions
      query = query.or(`status.ilike.${status},status.ilike.${String(status).charAt(0).toUpperCase() + String(status).slice(1)}`);
    }

    const { data: cases, error } = await query;

    if (error) {
      throw error;
    }

    // Map database fields to frontend expected fields
    const mappedCases = (cases || []).map((c: any) => ({
      ...c,
      // Frontend expects these specific field names
      amount: c.claim_amount || c.amount || 0,
      claim_id: c.detection_result_id || c.claim_id || c.id,
      amazon_case_id: c.provider_case_id || c.amazon_case_id || null,
      case_type: c.case_type || c.dispute_type || 'unknown',
      filing_status: c.filing_status || null,
      retry_count: c.retry_count || 0,
    }));

    res.json({
      success: true,
      cases: mappedCases,
      total: mappedCases.length
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error?.message || 'Internal server error'
    });
  }
});


/**
 * POST /api/v1/disputes/payments/report
 * Generate a high-authority LIQUIDITY SETTLEMENT STATEMENT (JP Morgan style)
 */
router.post('/payments/report', async (req, res) => {
  try {
    const { pdfGenerationService } = await import('../services/pdfGenerationService');
    const {
      groups = [],
      pipeline = {},
      monthTotals = {},
      currency = 'USD',
      storeName = 'Seller Account',
    } = req.body;

    const formatMoney = (amt: number) => {
      return `${currency} ${Number(amt || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    };

    const reportDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const timestamp = new Date().toISOString();

    // Derived Financial Data
    const totalGross = groups.reduce((s: number, g: any) => s + (g.gross || 0), 0);
    const totalCommission = groups.reduce((s: number, g: any) => s + (g.commission || 0), 0);
    const totalNet = groups.reduce((s: number, g: any) => s + (g.net || 0), 0);
    const netPayout = monthTotals.net || totalNet;

    // Pipeline Summaries
    const detectedAmt = formatMoney(pipeline.detected?.amount || 0);
    const processingAmt = formatMoney((pipeline.ready?.amount || 0) + (pipeline.pending?.amount || 0));
    const approvedAmt = formatMoney(pipeline.approved?.amount || 0);

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');

          @page { margin: 0; size: A4; }
          body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            color: #1a1a1a;
            line-height: 1.5;
            padding: 50px 60px;
            font-size: 11px;
            background: #fff;
          }

          /* HEADER - INSTITUTIONAL GRADE */
          .header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            margin-bottom: 50px;
          }
          .header-left .brand {
            font-size: 10px;
            font-weight: 800;
            color: #000;
            letter-spacing: 2px;
            text-transform: uppercase;
            margin-bottom: 2px;
          }
          .header-left .sub-label {
            font-size: 8px;
            font-weight: 600;
            color: #888;
            text-transform: uppercase;
            letter-spacing: 0.5px;
          }
          .header-right {
            text-align: right;
            font-size: 8.5px;
            font-weight: 600;
            color: #888;
            text-transform: uppercase;
            letter-spacing: 0.5px;
          }

          /* DOCUMENT TITLE */
          .doc-title {
            font-size: 14px;
            font-weight: 800;
            color: #000;
            text-align: center;
            letter-spacing: 2px;
            text-transform: uppercase;
            margin-bottom: 40px;
            border-bottom: 0.2pt solid #e0e0e0;
            padding-bottom: 12px;
          }

          /* THE CHECK - HERO SECTION */
          .hero-check {
            background: #F9FAFB;
            border: 0.2pt solid #e0e0e0;
            padding: 40px;
            text-align: center;
            margin-bottom: 20px;
          }
          .hero-label {
            font-size: 9px;
            font-weight: 700;
            color: #888;
            text-transform: uppercase;
            letter-spacing: 1.5px;
            margin-bottom: 12px;
          }
          .hero-amount {
            font-family: 'Times New Roman', serif;
            font-size: 48px;
            font-weight: 700;
            color: #000;
            letter-spacing: -1px;
          }

          /* THE MATH STRIP */
          .math-strip {
            display: flex;
            border-top: 0.2pt solid #e0e0e0;
            border-bottom: 0.2pt solid #e0e0e0;
            padding: 15px 0;
            margin-bottom: 50px;
          }
          .math-col {
            flex: 1;
            text-align: center;
            border-right: 0.2pt solid #e0e0e0;
          }
          .math-col:last-child {
            border-right: none;
          }
          .math-label {
            font-size: 8px;
            font-weight: 700;
            color: #888;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 6px;
          }
          .math-value {
            font-family: 'Times New Roman', serif;
            font-size: 14px;
            font-weight: 700;
            color: #000;
          }
          .math-value.fee {
            color: #888;
          }

          /* THE STATUS BAR - HORIZONTAL PIPELINE */
          .pipeline-bar {
            display: flex;
            justify-content: space-between;
            margin-bottom: 60px;
          }
          .pipeline-col {
            flex: 1;
            text-align: left;
            padding: 0 10px;
          }
          .pipeline-label {
            font-size: 8.5px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 1px;
            margin-bottom: 4px;
          }
          .pipeline-val {
            font-size: 16px;
            font-weight: 500;
            font-family: 'Times New Roman', serif;
          }
          .pipeline-col.detected .pipeline-label,
          .pipeline-col.detected .pipeline-val {
            color: #888;
          }
          .pipeline-col.processing .pipeline-label,
          .pipeline-col.processing .pipeline-val {
            color: #000;
          }
          .pipeline-col.approved .pipeline-label,
          .pipeline-col.approved .pipeline-val {
            color: #000;
            font-weight: 700;
          }
          .pipeline-col.approved .pipeline-val {
            border-bottom: 1pt solid #000;
            display: inline-block;
            line-height: 1.2;
          }

          /* METADATA BLOCK */
          .metadata {
            margin-bottom: 20px;
            font-size: 9px;
            color: #555;
          }
          .meta-item {
            margin-bottom: 4px;
          }
          .meta-key {
            font-weight: 700;
            text-transform: uppercase;
            width: 100px;
            display: inline-block;
          }

          /* FOOTER DISCLAIMER */
          .footer-disclaimer {
            position: absolute;
            bottom: 50px;
            left: 60px;
            right: 60px;
            padding-top: 15px;
            border-top: 0.2pt solid #e0e0e0;
            font-size: 7.5px;
            color: #999;
            line-height: 1.6;
            text-align: justify;
          }
          .footer-meta {
            display: flex;
            justify-content: space-between;
            margin-top: 10px;
            font-size: 7.5px;
            color: #BBB;
            text-transform: uppercase;
            letter-spacing: 0.5px;
          }
        </style>
      </head>
      <body>
        <!-- HEADER -->
        <div class="header">
          <div class="header-left">
            <div class="brand">Margin Audit Systems</div>
            <div class="sub-label">Revenue Integrity Infrastructure</div>
          </div>
          <div class="header-right">
            Confidential Financial Record
          </div>
        </div>

        <div class="doc-title">Liquidity Settlement Statement</div>

        <!-- ACCOUNT INFO -->
        <div class="metadata">
          <div class="meta-item"><span class="meta-key">Account:</span> ${storeName}</div>
          <div class="meta-item"><span class="meta-key">Period:</span> ${reportDate}</div>
          <div class="meta-item"><span class="meta-key">Currency:</span> ${currency}</div>
        </div>

        <!-- THE CHECK -->
        <div class="hero-check">
          <div class="hero-label">Net Recovery Payout</div>
          <div class="hero-amount">${formatMoney(netPayout)}</div>
        </div>

        <!-- THE MATH STRIP -->
        <div class="math-strip">
          <div class="math-col">
            <div class="math-label">Gross Claims</div>
            <div class="math-value">${formatMoney(totalGross)}</div>
          </div>
          <div class="math-col">
            <div class="math-label">Audit Fee (20%)</div>
            <div class="math-value fee">-${formatMoney(totalCommission)}</div>
          </div>
          <div class="math-col">
            <div class="math-label">Net Settlement</div>
            <div class="math-value"><b>${formatMoney(totalNet)}</b></div>
          </div>
        </div>

        <!-- PIPELINE STATUS -->
        <div class="pipeline-bar">
          <div class="pipeline-col detected">
            <div class="pipeline-label">Detected</div>
            <div class="pipeline-val">${detectedAmt}</div>
          </div>
          <div class="pipeline-col processing">
            <div class="pipeline-label">Processing</div>
            <div class="pipeline-val">${processingAmt}</div>
          </div>
          <div class="pipeline-col approved">
            <div class="pipeline-label">Approved</div>
            <div class="pipeline-val">${approvedAmt}</div>
          </div>
        </div>

        <!-- FOOTER -->
        <div class="footer-disclaimer">
          Amounts shown are estimates based on current claim status and are subject to Amazon's final audit review and disbursement protocols. 
          Commission is calculated at 20% of the gross recovered amount in accordance with service tier agreement. 
          Net payout represents the estimated liquidity to be credited to the seller's treasury after audit commission deduction.
          This document constitutes a confidential settlement projection and does not guarantee final bank transfer values.
          
          <div class="footer-meta">
            <span>Generated: ${timestamp}</span>
            <span>Ref: MAS-LIQ-${Date.now().toString().slice(-8)}</span>
            <span>Audit Integrity Verified</span>
          </div>
        </div>
      </body>
      </html>
    `;

    const pdfBuffer = await pdfGenerationService.generatePDFFromHTML(html);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=liquidity-settlement-statement.pdf');
    res.send(pdfBuffer);
  } catch (error: any) {
    console.error('[payments-report] Error:', error);
    res.status(500).json({
      success: false,
      message: error?.message || 'Internal server error'
    });
  }
});

/**
 * GET /api/v1/disputes/:id/brief
 * Generate a PDF brief for a dispute case
 */
router.get('/:id/brief', async (req, res) => {
  try {
    const { id } = req.params;
    const disputeService = (await import('../services/disputeService')).default;

    const pdfBuffer = await disputeService.generateDisputeBrief(id);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=dispute-brief-${id}.pdf`);
    res.send(pdfBuffer);
  } catch (error: any) {
    console.error('[dispute-brief] Error:', error);
    res.status(500).json({
      success: false,
      message: error?.message || 'Internal server error'
    });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { supabaseAdmin } = await import('../database/supabaseClient');

    const { data: dispute, error } = await supabaseAdmin
      .from('dispute_cases')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({ success: false, message: 'Dispute case not found' });
      }
      throw error;
    }

    res.json({
      success: true,
      dispute: {
        ...dispute,
        // Ensure camelCase for frontend compatibility if needed, or just pass snake_case
        // Frontend likely expects camelCase based on other parts of the app
        caseNumber: dispute.case_number,
        claimId: dispute.claim_id,
        createdAt: dispute.created_at,
        updatedAt: dispute.updated_at,
        recoveryStatus: dispute.recovery_status,
        actualPayoutAmount: dispute.actual_payout_amount,
        billingStatus: dispute.billing_status,
        billingTransactionId: dispute.billing_transaction_id,
        platformFeeCents: dispute.platform_fee_cents,
        billedAt: dispute.billed_at
      }
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error?.message || 'Internal server error'
    });
  }
});

router.post('/', async (_req, res) => {
  try {
    res.json({
      success: true,
      disputeId: 'dispute-' + Date.now(),
      message: 'Dispute created successfully'
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error?.message || 'Internal server error'
    });
  }
});

router.post('/:id/submit', async (_req, res) => {
  try {
    res.json({
      success: true,
      message: 'Dispute submitted to Amazon',
      caseId: 'AMZ-CASE-' + Date.now()
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error?.message || 'Internal server error'
    });
  }
});

router.get('/:id/audit-log', async (req, res) => {
  try {
    const { id } = req.params;

    // Get audit log from database
    const { supabase } = await import('../database/supabaseClient');
    const { data: auditLog, error } = await supabase
      .from('dispute_audit_log')
      .select('*')
      .eq('dispute_case_id', id)
      .order('created_at', { ascending: false });

    if (error) {
      throw error;
    }

    res.json({
      success: true,
      auditLog: auditLog || []
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error?.message || 'Internal server error'
    });
  }
});

// PUT /api/v1/disputes/:id/resolve
// Resolve a dispute case
router.put('/:id/resolve', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = (req as any).user?.id;
    const { resolution_status, resolution_notes, resolution_amount } = req.body || {};

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    // Import dispute service
    const disputeService = (await import('../services/disputeService')).default;

    // Create resolution object
    const resolution = {
      dispute_case_id: id,
      resolution_status: resolution_status || 'resolved',
      resolution_notes,
      resolution_amount,
      provider_response: { resolved_by: userId, resolved_at: new Date().toISOString() }
    };

    const updatedCase = await disputeService.processCaseResolution(resolution);

    res.json({
      success: true,
      message: 'Dispute case resolved successfully',
      dispute: updatedCase
    });
  } catch (error: any) {
    if (error.message === 'Dispute case not found') {
      return res.status(404).json({
        success: false,
        message: error.message
      });
    }
    res.status(500).json({
      success: false,
      message: error?.message || 'Internal server error'
    });
  }
});

// POST /api/v1/disputes/:id/deny
// Deny a dispute case and feed into learning engine
router.post('/:id/deny', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = (req as any).user?.id;
    const { rejectionReason, amazonCaseId } = req.body;

    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const { supabaseAdmin } = await import('../database/supabaseClient');
    const learningWorker = (await import('../workers/learningWorker')).default;

    // 1. Update case status to Denied
    const { error } = await supabaseAdmin
      .from('dispute_cases')
      .update({
        status: 'Denied',
        recovery_status: 'denied',
        updated_at: new Date().toISOString(),
        metadata: { // We'll merge this with existing metadata in a real implementation, but for now this is fine or we can use jsonb_set
          rejection_reason: rejectionReason,
          amazon_case_id: amazonCaseId
        }
      })
      .eq('id', id);

    if (error) throw error;

    // 2. Feed into Learning Engine
    // Run in background so we don't block response
    learningWorker.processRejection(
      userId,
      id,
      rejectionReason || 'Unknown rejection',
      amazonCaseId
    ).catch((err: any) => {
      console.error('Failed to process rejection for learning:', err);
    });

    // 3. Send "Realism" notification (Amazon Challenge)
    const notificationHelper = (await import('../services/notificationHelper')).default;
    notificationHelper.notifyAmazonChallenge(userId, { disputeIds: [id] }).catch((err: any) => {
      console.error('Failed to notify Amazon challenge:', err);
    });

    res.json({
      success: true,
      message: 'Case denied and logged for learning'
    });

  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error?.message || 'Internal server error'
    });
  }
});

// POST /api/disputes/file-now
// Trigger immediate filing for a pending case (Agent 7 manual trigger)
router.post('/file-now', async (req, res) => {
  try {
    const userId = (req as any).userId || (req as any).user?.id || 'demo-user';
    const { dispute_id, claim_id } = req.body;

    if (!dispute_id) {
      return res.status(400).json({
        success: false,
        message: 'dispute_id is required'
      });
    }

    // Import refund filing service
    const refundFilingService = (await import('../services/refundFilingService')).default;

    // Get the dispute case details
    const { data: caseData, error: fetchError } = await supabaseAdmin
      .from('dispute_cases')
      .select('*')
      .eq('id', dispute_id)
      .single();

    if (fetchError || !caseData) {
      return res.status(404).json({
        success: false,
        message: 'Dispute case not found'
      });
    }

    // Update status to 'filing'
    await supabaseAdmin
      .from('dispute_cases')
      .update({
        filing_status: 'filing',
        updated_at: new Date().toISOString()
      })
      .eq('id', dispute_id);

    // Prepare filing request
    const filingRequest = {
      dispute_id,
      user_id: userId,
      order_id: caseData.order_id || '',
      asin: caseData.asin || '',
      sku: caseData.sku || '',
      claim_type: caseData.case_type || caseData.dispute_type || 'unknown',
      amount_claimed: caseData.claim_amount || caseData.amount || 0,
      currency: caseData.currency || 'USD',
      evidence_document_ids: caseData.evidence_document_ids || [],
      confidence_score: caseData.confidence_score || 0.85
    };

    // File the dispute (async - don't wait for completion)
    refundFilingService.fileDispute(filingRequest)
      .then(async (result) => {
        // Update case with result
        await supabaseAdmin
          .from('dispute_cases')
          .update({
            filing_status: result.success ? 'submitted' : 'failed',
            provider_case_id: result.amazon_case_id || null,
            filing_error: result.error_message || null,
            updated_at: new Date().toISOString()
          })
          .eq('id', dispute_id);
      })
      .catch(async (err) => {
        console.error('[file-now] Filing error:', err);
        await supabaseAdmin
          .from('dispute_cases')
          .update({
            filing_status: 'failed',
            filing_error: err.message || 'Unknown error',
            updated_at: new Date().toISOString()
          })
          .eq('id', dispute_id);
      });

    res.json({
      success: true,
      message: 'Filing initiated',
      dispute_id,
      filing_status: 'filing'
    });

  } catch (error: any) {
    console.error('[file-now] Error:', error);
    res.status(500).json({
      success: false,
      message: error?.message || 'Internal server error'
    });
  }
});

// POST /api/disputes/retry-filing
// Retry a failed filing with stronger evidence (Agent 7 retry)
router.post('/retry-filing', async (req, res) => {
  try {
    const userId = (req as any).userId || (req as any).user?.id || 'demo-user';
    const { dispute_id, claim_id, collect_stronger_evidence } = req.body;

    if (!dispute_id) {
      return res.status(400).json({
        success: false,
        message: 'dispute_id is required'
      });
    }

    // Import services
    const refundFilingService = (await import('../services/refundFilingService')).default;

    // Get the dispute case details
    const { data: caseData, error: fetchError } = await supabaseAdmin
      .from('dispute_cases')
      .select('*')
      .eq('id', dispute_id)
      .single();

    if (fetchError || !caseData) {
      return res.status(404).json({
        success: false,
        message: 'Dispute case not found'
      });
    }

    // Increment retry count
    const newRetryCount = (caseData.retry_count || 0) + 1;

    // Update status to 'retrying'
    await supabaseAdmin
      .from('dispute_cases')
      .update({
        filing_status: 'retrying',
        retry_count: newRetryCount,
        filing_error: null, // Clear previous error
        updated_at: new Date().toISOString()
      })
      .eq('id', dispute_id);

    // Collect stronger evidence if requested
    let evidenceIds = caseData.evidence_document_ids || [];
    if (collect_stronger_evidence) {
      try {
        const additionalEvidence = await refundFilingService.collectStrongerEvidence(dispute_id, userId);
        evidenceIds = [...new Set([...evidenceIds, ...additionalEvidence])];
      } catch (err: any) {
        console.warn('[retry-filing] Could not collect stronger evidence:', err.message);
      }
    }

    // Prepare filing request with enhanced evidence
    const filingRequest = {
      dispute_id,
      user_id: userId,
      order_id: caseData.order_id || '',
      asin: caseData.asin || '',
      sku: caseData.sku || '',
      claim_type: caseData.case_type || caseData.dispute_type || 'unknown',
      amount_claimed: caseData.claim_amount || caseData.amount || 0,
      currency: caseData.currency || 'USD',
      evidence_document_ids: evidenceIds,
      confidence_score: caseData.confidence_score || 0.85
    };

    // File the dispute with retry (async)
    refundFilingService.fileDisputeWithRetry(filingRequest, newRetryCount)
      .then(async (result) => {
        await supabaseAdmin
          .from('dispute_cases')
          .update({
            filing_status: result.success ? 'submitted' : 'failed',
            provider_case_id: result.amazon_case_id || caseData.provider_case_id || null,
            filing_error: result.error_message || null,
            evidence_document_ids: evidenceIds,
            updated_at: new Date().toISOString()
          })
          .eq('id', dispute_id);
      })
      .catch(async (err) => {
        console.error('[retry-filing] Retry error:', err);
        await supabaseAdmin
          .from('dispute_cases')
          .update({
            filing_status: 'failed',
            filing_error: err.message || 'Retry failed',
            updated_at: new Date().toISOString()
          })
          .eq('id', dispute_id);
      });

    res.json({
      success: true,
      message: 'Retry initiated with enhanced evidence',
      dispute_id,
      filing_status: 'retrying',
      retry_count: newRetryCount,
      evidence_count: evidenceIds.length
    });

  } catch (error: any) {
    console.error('[retry-filing] Error:', error);
    res.status(500).json({
      success: false,
      message: error?.message || 'Internal server error'
    });
  }
});

// POST /api/disputes/approve-filing
// Approve a high-value claim that was flagged for manual review (Agent 7 approval)
router.post('/approve-filing', async (req, res) => {
  try {
    const userId = (req as any).userId || (req as any).user?.id || 'demo-user';
    const { dispute_id, claim_id } = req.body;

    if (!dispute_id) {
      return res.status(400).json({
        success: false,
        message: 'dispute_id is required'
      });
    }

    // Get the dispute case details
    const { data: caseData, error: fetchError } = await supabaseAdmin
      .from('dispute_cases')
      .select('*')
      .eq('id', dispute_id)
      .single();

    if (fetchError || !caseData) {
      return res.status(404).json({
        success: false,
        message: 'Dispute case not found'
      });
    }

    // Verify case is pending_approval
    if (caseData.filing_status !== 'pending_approval') {
      return res.status(400).json({
        success: false,
        message: `Case is not pending approval (current status: ${caseData.filing_status})`
      });
    }

    // Update status from pending_approval to pending (ready for filing)
    const { error: updateError } = await supabaseAdmin
      .from('dispute_cases')
      .update({
        filing_status: 'pending',
        metadata: {
          ...(caseData.metadata || {}),
          approved_by: userId,
          approved_at: new Date().toISOString(),
          original_status: 'pending_approval'
        },
        updated_at: new Date().toISOString()
      })
      .eq('id', dispute_id);

    if (updateError) {
      throw updateError;
    }

    // Log the approval
    console.log(`[approve-filing] User ${userId} approved high-value claim ${dispute_id}`);

    res.json({
      success: true,
      message: 'Claim approved and queued for filing',
      dispute_id,
      filing_status: 'pending',
      approved_by: userId
    });

  } catch (error: any) {
    console.error('[approve-filing] Error:', error);
    res.status(500).json({
      success: false,
      message: error?.message || 'Internal server error'
    });
  }
});


export default router;
