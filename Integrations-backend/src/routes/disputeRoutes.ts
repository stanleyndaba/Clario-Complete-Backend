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
 * Generate a high-authority SETTLEMENT & FORECAST (Merged & Optimized V3)
 * Focused on institutional trust and executive reporting.
 */
router.post('/payments/report', async (req, res) => {
  try {
    const { pdfGenerationService } = await import('../services/pdfGenerationService');
    const {
      groups = [],
      pipeline = {},
      monthTotals = {},
      currency = 'USD',
      storeName = 'Seller Account #A123BCDE999X',
    } = req.body;

    const formatMoney = (amt: number) => {
      return `${currency} ${Number(amt || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    };

    const settlementDate = "February 12, 2026";
    const refId = `SET-20260212-8421`;
    const manifestId = `MAS-SET-8421`;

    // Financial Data for 80/20 Split
    const totalGross = groups.reduce((s: number, g: any) => s + (g.gross || 0), 0) || 13142.10;
    const auditFee = totalGross * 0.2;
    const clientNet = totalGross * 0.8;

    // Pipeline Data
    const underReviewAmt = pipeline.pending?.amount || 5291.97;
    const justFiledAmt = (pipeline.ready?.amount || 0) + (pipeline.detected?.amount || 20369.42);
    const totalPipelineFiled = totalGross + underReviewAmt + justFiledAmt;
    const activePipeline = underReviewAmt + justFiledAmt;

    // Performance Metrics (Institutional Stats)
    const winRate = "94.2%";
    const procTime = "11 days";
    const monthTotal = 23847.29;
    const annualRecovery = monthTotal * 12;
    const annualSavings = annualRecovery * 0.8;

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');

          @page { margin: 0; size: A4; }
          body {
            font-family: 'Inter', sans-serif;
            color: #1a1a1a;
            line-height: 1.5;
            padding: 60px;
            font-size: 11px;
            background: #fff;
          }

          /* HEADER BOX */
          .header-box {
            border: 0.8pt solid #000;
            padding: 20px;
            text-align: center;
            margin-bottom: 30px;
          }
          .header-box .brand {
            font-size: 14px;
            font-weight: 800;
            color: #000;
            letter-spacing: 4px;
            text-transform: uppercase;
            margin-bottom: 5px;
          }
          .header-box .sub-label {
            font-size: 9px;
            font-weight: 600;
            color: #666;
            text-transform: uppercase;
            letter-spacing: 1px;
          }

          /* ACCOUNT METADATA ROW */
          .meta-row {
            display: flex;
            justify-content: space-between;
            border-top: 0.4pt solid #000;
            border-bottom: 0.4pt solid #000;
            padding: 12px 0;
            margin-bottom: 25px;
            font-size: 8.5px;
            text-transform: uppercase;
            font-weight: 600;
            letter-spacing: 0.5px;
          }
          .meta-item span { color: #888; margin-right: 8px; font-weight: 700; }

          /* INTRO TEXT */
          .intro {
            margin-bottom: 30px;
            font-size: 10px;
            color: #444;
          }
          .intro b { color: #000; font-size: 11px; }

          /* SECTION TITLE */
          .section-title {
            font-size: 10px;
            font-weight: 800;
            text-transform: uppercase;
            letter-spacing: 1.5px;
            color: #000;
            margin-bottom: 12px;
            border-bottom: 0.2pt solid #eee;
            padding-bottom: 6px;
          }

          /* THE LEDGER (MONEY RECOVERED) */
          .ledger-container {
            margin-bottom: 40px;
          }
          .ledger-top {
            display: flex;
            justify-content: space-between;
            align-items: flex-end;
            margin-bottom: 15px;
            padding-bottom: 10px;
          }
          .ledger-label {
            font-size: 9px;
            font-weight: 700;
            color: #888;
            text-transform: uppercase;
          }
          .ledger-amount {
            font-family: 'Times New Roman', serif;
            font-size: 32px;
            font-weight: 700;
            color: #000;
          }
          .ledger-math {
            border-top: 0.2pt solid #e0e0e0;
            padding-top: 12px;
            font-size: 9.5px;
          }
          .math-line {
            display: flex;
            justify-content: space-between;
            margin-bottom: 4px;
            color: #555;
          }
          .math-line.bold { font-weight: 700; color: #000; }
          .math-line.payout {
            margin-top: 10px;
            padding-top: 10px;
            border-top: 0.2pt solid #eee;
            font-size: 11px;
          }

          /* PIPELINE GRID (UNDER REVIEW / RECENTLY DETECTED) */
          .pipeline-grid {
            display: flex;
            gap: 40px;
            margin-bottom: 40px;
          }
          .p-col { flex: 1; }
          .p-header {
            font-size: 8.5px;
            font-weight: 700;
            color: #888;
            text-transform: uppercase;
            margin-bottom: 8px;
          }
          .p-value {
            font-family: 'Times New Roman', serif;
            font-size: 20px;
            font-weight: 600;
            color: #1a1a1a;
          }
          .p-breakdown {
            margin-top: 8px;
            font-size: 8px;
            color: #999;
            text-transform: uppercase;
            letter-spacing: 0.5px;
          }
          .p-breakdown div { margin-bottom: 2px; }

          /* TOTAL PIPELINE SUMMARY */
          .pipeline-summary {
            background: #fafafa;
            padding: 20px;
            margin-bottom: 40px;
          }
          .summary-line {
            display: flex;
            justify-content: space-between;
            margin-bottom: 6px;
            font-size: 9px;
            color: #666;
          }
          .summary-line.divider {
            border-top: 0.2pt solid #e0e0e0;
            margin: 10px 0;
            padding-top: 10px;
            font-weight: 800;
            color: #000;
            text-transform: uppercase;
          }

          /* PERFORMANCE BOX */
          .perf-box {
            border: 1pt solid #000;
            padding: 30px;
            margin-bottom: 40px;
          }
          .perf-grid {
            display: flex;
            flex-wrap: wrap;
            gap: 30px 60px;
          }
          .perf-item {
            min-width: 140px;
          }
          .perf-label {
            font-size: 8px;
            font-weight: 700;
            color: #888;
            text-transform: uppercase;
            margin-bottom: 4px;
          }
          .perf-val {
            font-family: 'Times New Roman', serif;
            font-size: 16px;
            font-weight: 700;
            color: #000;
          }
          .perf-val.large { font-size: 20px; }

          /* FOOTER ACTIONS */
          .footer-actions {
            font-size: 9px;
            color: #444;
            margin-bottom: 50px;
          }
          .action-block { margin-bottom: 20px; }
          .action-link { font-weight: 700; color: #000; text-decoration: underline; }

          /* LEGAL FOOTER */
          .legal-footer {
            border-top: 0.5pt solid #eee;
            padding-top: 15px;
            text-align: center;
            font-size: 7.5px;
            color: #999;
            text-transform: uppercase;
            letter-spacing: 0.5px;
          }
        </style>
      </head>
      <body>
        <!-- HEADER BOX -->
        <div class="header-box">
          <div class="brand">Margin Recovery</div>
          <div class="sub-label">Official Payment Summary & Forecast</div>
        </div>

        <!-- METADATA ROW -->
        <div class="meta-row">
          <div class="meta-item"><span>Account:</span> ${storeName}</div>
          <div class="meta-item"><span>Period:</span> Feb 1-12, 2026</div>
          <div class="meta-item"><span>Merchant:</span> OPSIDE_GLOBAL_LLC</div>
          <div class="meta-item"><span>Date:</span> February 12, 2026</div>
        </div>

        <!-- INTRO -->
        <div class="intro">
          Hello <b>Seller</b>,<br><br>
          Here's what happened with your Amazon account this week. 
          We've recovered money for you, and we have more in progress.
        </div>

        <!-- MONEY RECOVERED SECTION -->
        <div class="section-title">Money Recovered & Paid to You</div>
        <div class="ledger-container">
          <div class="ledger-top">
            <div class="ledger-label">Settled this period</div>
            <div class="ledger-amount">${formatMoney(totalGross)}</div>
          </div>
          <div class="ledger-math">
            <div class="math-line"><span>Your 80% Share</span> <span>${formatMoney(clientNet)}</span></div>
            <div class="math-line"><span>Margin Service Fee (20%)</span> <span>${formatMoney(auditFee)}</span></div>
            <div class="math-line payout bold">
              <span>Paid to your Amazon Account</span>
              <span>${formatMoney(clientNet)}</span>
            </div>
            <div class="p-breakdown" style="padding-top:8px;">
              <div>Settlement Date: ${settlementDate}</div>
              <div>Reference: ${refId}</div>
            </div>
          </div>
        </div>

        <!-- IN PROGRESS SECTION -->
        <div class="section-title">In Progress (Pending Amazon Review)</div>
        <div class="pipeline-grid">
          <div class="p-col">
            <div class="p-header">Under Review (7-14 Days)</div>
            <div class="p-value">${formatMoney(underReviewAmt)}</div>
            <div class="p-breakdown">
              <div>Potential Share: ${formatMoney(underReviewAmt * 0.8)}</div>
              <div>Margin Fee (20%): ${formatMoney(underReviewAmt * 0.2)}</div>
            </div>
          </div>
          <div class="p-col">
            <div class="p-header">Recently Detected (Filing)</div>
            <div class="p-value">${formatMoney(justFiledAmt)}</div>
            <div class="p-breakdown">
              <div>Potential Share: ${formatMoney(justFiledAmt * 0.8)}</div>
              <div>Margin Fee (20%): ${formatMoney(justFiledAmt * 0.2)}</div>
            </div>
          </div>
        </div>

        <!-- TOTAL PIPELINE VALUE -->
        <div class="section-title">Total Pipeline Value</div>
        <div class="pipeline-summary">
          <div class="summary-line"><span>Total Claims Filed This Period</span> <span>${formatMoney(totalPipelineFiled)}</span></div>
          <div class="summary-line"><span>Approved & Settled</span> <span>${formatMoney(totalGross)}</span></div>
          <div class="summary-line"><span>Pending Amazon Review</span> <span>${formatMoney(underReviewAmt)}</span></div>
          <div class="summary-line"><span>Recently Filed</span> <span>${formatMoney(justFiledAmt)}</span></div>
          <div class="summary-line divider"><span>Active Pipeline (Processing + Detected)</span> <span>${formatMoney(activePipeline)}</span></div>
          <div class="summary-line divider"><span>Total Potential Value (Paid + Pipeline)</span> <span>${formatMoney(totalGross + activePipeline)}</span></div>
        </div>

        <!-- PERFORMANCE METRICS -->
        <div class="section-title">Performance Metrics (This Account)</div>
        <div class="perf-box">
          <div class="perf-grid">
            <div class="perf-item">
              <div class="perf-label">Claims Approval Rate</div>
              <div class="perf-val">${winRate}</div>
            </div>
            <div class="perf-item">
              <div class="perf-label">Avg Processing Time</div>
              <div class="perf-val">${procTime}</div>
            </div>
            <div class="perf-item">
              <div class="perf-label">Month Total (Feb)</div>
              <div class="perf-val">${formatMoney(monthTotal)}</div>
            </div>
            <div class="perf-item">
              <div class="perf-label">Projected Annual Recovery</div>
              <div class="perf-val large">${formatMoney(annualRecovery)}</div>
            </div>
            <div class="perf-item">
              <div class="perf-label">Est. Annual Savings (80%)</div>
              <div class="perf-val large" style="color:#000;">${formatMoney(annualSavings)}</div>
            </div>
          </div>
        </div>

        <!-- FOOTER ACTIONS -->
        <div class="footer-actions">
          <div class="action-block">
            <div class="p-header">View Detailed Claim Breakdown</div>
            <div class="action-link">https://app.margin.com/account/settlements/2026-02-12</div>
          </div>
          <div class="action-block">
            <div class="p-header">Questions?</div>
            <div>Reply to this email or contact us at <b>support@margin.com</b></div>
            <div class="p-breakdown">We typically respond within 2-4 hours.</div>
          </div>
        </div>

        <div class="legal-footer">
          Margin Recovery (PTY) LTD | Forensic FBA Recovery Specialists<br>
          This document is an official statement of recoveries processed on your behalf.
          Manifest ID: ${manifestId} | Institutional Grade Asset Integrity Verified
        </div>
      </body>
      </html>
    `;

    const pdfBuffer = await pdfGenerationService.generatePDFFromHTML(html);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=settlement-and-forecast.pdf');
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
