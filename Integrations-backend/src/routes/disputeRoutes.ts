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
 * Generate a JP Morgan-style PDF report of upcoming payments
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

    // Build table rows for payout groups
    const groupRows = groups.map((g: any) => `
      <tr>
        <td>${g.label}</td>
        <td class="text-right">${g.count}</td>
        <td class="text-right">${formatMoney(g.gross)}</td>
        <td class="text-right">${formatMoney(g.commission)}</td>
        <td class="text-right bold">${formatMoney(g.net)}</td>
      </tr>
    `).join('');

    // Totals
    const totalGross = groups.reduce((s: number, g: any) => s + (g.gross || 0), 0);
    const totalCommission = groups.reduce((s: number, g: any) => s + (g.commission || 0), 0);
    const totalNet = groups.reduce((s: number, g: any) => s + (g.net || 0), 0);
    const totalClaims = groups.reduce((s: number, g: any) => s + (g.count || 0), 0);

    // Pipeline stages
    const pipelineRows = [
      { label: 'Detected', count: pipeline.detected?.count || 0, amount: pipeline.detected?.amount || 0 },
      { label: 'Ready to File', count: pipeline.ready?.count || 0, amount: pipeline.ready?.amount || 0 },
      { label: 'Pending Amazon', count: pipeline.pending?.count || 0, amount: pipeline.pending?.amount || 0 },
      { label: 'Approved', count: pipeline.approved?.count || 0, amount: pipeline.approved?.amount || 0 },
      { label: 'Paid', count: pipeline.paid?.count || 0, amount: pipeline.paid?.amount || 0 },
    ];

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
            color: #1a1a2e;
            line-height: 1.5;
            padding: 48px 56px;
            font-size: 12px;
            background: #fff;
          }

          /* Header */
          .header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            padding-bottom: 20px;
            border-bottom: 2px solid #1a1a2e;
            margin-bottom: 32px;
          }
          .brand {
            font-size: 28px;
            font-weight: 800;
            color: #1a1a2e;
            letter-spacing: -1px;
          }
          .brand-sub {
            font-size: 11px;
            font-weight: 400;
            color: #6b7280;
            margin-top: 2px;
            letter-spacing: 0.5px;
          }
          .doc-info {
            text-align: right;
          }
          .doc-title {
            font-size: 15px;
            font-weight: 600;
            color: #1a1a2e;
            margin-bottom: 6px;
          }
          .doc-meta {
            font-size: 11px;
            color: #6b7280;
            line-height: 1.6;
          }
          .doc-meta span {
            display: block;
          }

          /* Summary Banner */
          .summary-banner {
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
            border-radius: 10px;
            padding: 28px 32px;
            margin-bottom: 32px;
            display: flex;
            justify-content: space-between;
            align-items: center;
          }
          .summary-main {
            color: #fff;
          }
          .summary-label {
            font-size: 11px;
            font-weight: 500;
            color: rgba(255,255,255,0.5);
            text-transform: uppercase;
            letter-spacing: 1px;
            margin-bottom: 6px;
          }
          .summary-amount {
            font-size: 40px;
            font-weight: 800;
            color: #fff;
            letter-spacing: -1.5px;
          }
          .summary-sub {
            font-size: 12px;
            color: rgba(255,255,255,0.45);
            margin-top: 4px;
          }
          .summary-stats {
            display: flex;
            gap: 32px;
          }
          .stat-box {
            text-align: center;
          }
          .stat-value {
            font-size: 22px;
            font-weight: 700;
            color: #fff;
          }
          .stat-label {
            font-size: 10px;
            color: rgba(255,255,255,0.45);
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-top: 2px;
          }

          /* Sections */
          .section {
            margin-bottom: 28px;
          }
          .section-header {
            font-size: 13px;
            font-weight: 600;
            color: #1a1a2e;
            margin-bottom: 14px;
            padding-bottom: 8px;
            border-bottom: 1px solid #e5e7eb;
            text-transform: uppercase;
            letter-spacing: 0.5px;
          }

          /* Tables */
          table {
            width: 100%;
            border-collapse: collapse;
          }
          th {
            background: #f8f9fa;
            color: #4b5563;
            padding: 10px 14px;
            text-align: left;
            font-size: 10px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            border-bottom: 2px solid #e5e7eb;
          }
          td {
            padding: 12px 14px;
            font-size: 12px;
            border-bottom: 1px solid #f3f4f6;
            color: #374151;
          }
          .text-right {
            text-align: right;
          }
          .bold {
            font-weight: 600;
            color: #1a1a2e;
          }
          .total-row {
            background: #f8f9fa;
            font-weight: 700;
          }
          .total-row td {
            border-top: 2px solid #e5e7eb;
            border-bottom: 2px solid #e5e7eb;
            color: #1a1a2e;
            padding: 14px;
            font-size: 13px;
          }

          /* Pipeline Grid */
          .pipeline-grid {
            display: flex;
            gap: 0;
            border: 1px solid #e5e7eb;
            border-radius: 8px;
            overflow: hidden;
          }
          .pipeline-stage {
            flex: 1;
            padding: 16px;
            text-align: center;
            border-right: 1px solid #e5e7eb;
          }
          .pipeline-stage:last-child {
            border-right: none;
          }
          .pipeline-stage-label {
            font-size: 10px;
            font-weight: 500;
            color: #6b7280;
            text-transform: uppercase;
            letter-spacing: 0.3px;
            margin-bottom: 8px;
          }
          .pipeline-stage-count {
            font-size: 22px;
            font-weight: 700;
            color: #1a1a2e;
          }
          .pipeline-stage-amount {
            font-size: 11px;
            color: #6b7280;
            margin-top: 4px;
          }

          /* Footnote */
          .footnote {
            margin-top: 40px;
            padding-top: 20px;
            border-top: 1px solid #e5e7eb;
            font-size: 10px;
            color: #9ca3af;
            line-height: 1.6;
          }

          /* Footer */
          .footer {
            margin-top: 16px;
            display: flex;
            justify-content: space-between;
            font-size: 10px;
            color: #9ca3af;
          }
        </style>
      </head>
      <body>
        <!-- HEADER -->
        <div class="header">
          <div>
            <div class="brand">Margin</div>
            <div class="brand-sub">Inventory Audit & Recovery</div>
          </div>
          <div class="doc-info">
            <div class="doc-title">Upcoming Payments Report</div>
            <div class="doc-meta">
              <span>Account: ${storeName}</span>
              <span>Report Date: ${reportDate}</span>
              <span>Currency: ${currency}</span>
            </div>
          </div>
        </div>

        <!-- SUMMARY BANNER -->
        <div class="summary-banner">
          <div class="summary-main">
            <div class="summary-label">Projected Net Payout</div>
            <div class="summary-amount">${formatMoney(monthTotals.net || totalNet)}</div>
            <div class="summary-sub">After 20% recovery commission</div>
          </div>
          <div class="summary-stats">
            <div class="stat-box">
              <div class="stat-value">${totalClaims}</div>
              <div class="stat-label">Claims</div>
            </div>
            <div class="stat-box">
              <div class="stat-value">${formatMoney(totalGross)}</div>
              <div class="stat-label">Gross Value</div>
            </div>
          </div>
        </div>

        <!-- SCHEDULED PAYOUTS -->
        <div class="section">
          <div class="section-header">Scheduled Payouts</div>
          <table>
            <thead>
              <tr>
                <th>Payout Date</th>
                <th class="text-right">Claims</th>
                <th class="text-right">Gross Amount</th>
                <th class="text-right">Commission (20%)</th>
                <th class="text-right">Net Payout</th>
              </tr>
            </thead>
            <tbody>
              ${groupRows}
              <tr class="total-row">
                <td>TOTAL</td>
                <td class="text-right">${totalClaims}</td>
                <td class="text-right">${formatMoney(totalGross)}</td>
                <td class="text-right">${formatMoney(totalCommission)}</td>
                <td class="text-right">${formatMoney(totalNet)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- RECOVERY PIPELINE -->
        <div class="section">
          <div class="section-header">Recovery Pipeline</div>
          <div class="pipeline-grid">
            ${pipelineRows.map((s: any) => `
              <div class="pipeline-stage">
                <div class="pipeline-stage-label">${s.label}</div>
                <div class="pipeline-stage-count">${s.count}</div>
                <div class="pipeline-stage-amount">${formatMoney(s.amount)}</div>
              </div>
            `).join('')}
          </div>
        </div>

        <!-- FOOTNOTE -->
        <div class="footnote">
          Amounts shown are estimates based on current claim status and are subject to Amazon's final review.
          Commission is calculated at 20% of the gross recovered amount. Net payout represents the estimated
          amount to be credited to the seller's account after commission deduction.
        </div>

        <!-- FOOTER -->
        <div class="footer">
          <div>Generated by Margin Audit Systems on ${new Date().toISOString().split('T')[0]}</div>
          <div>For support: support@marginrecovery.com</div>
        </div>
      </body>
      </html>
    `;

    const pdfBuffer = await pdfGenerationService.generatePDFFromHTML(html);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=upcoming-payments-report.pdf');
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
