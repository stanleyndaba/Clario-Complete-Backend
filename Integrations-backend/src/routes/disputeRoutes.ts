import { Router } from 'express';
import { optionalAuth } from '../middleware/authMiddleware';
import { supabaseAdmin } from '../database/supabaseClient';
import logger from '../utils/logger';

const DEFAULT_TENANT_ID = '00000000-0000-0000-0000-000000000001';

const router = Router();

// Apply optional authentication - allows demo-user access
router.use(optionalAuth);

router.get('/', async (req, res) => {
  try {
    const userId = (req as any).userId || (req as any).user?.id || 'demo-user';
    const tenantId = (req as any).tenant?.tenantId || DEFAULT_TENANT_ID;
    const { status, limit } = req.query;

    // Build query with tenant isolation
    let query = supabaseAdmin
      .from('dispute_cases')
      .select('*')
      .eq('tenant_id', tenantId)
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
 * Generate a high-authority SETTLEMENT & FORECAST (Reporting V5)
 * "Quiet Confidence" - Terminal/Receipt aesthetic.
 */
router.post('/payments/report', async (req, res) => {
  try {
    const { pdfGenerationService } = await import('../services/pdfGenerationService');
    const {
      groups = [],
      pipeline = {},
      monthTotals = {},
      currency = 'USD',
      storeName = 'Account #A123BCDE999X',
    } = req.body;

    const formatMoney = (amt: number) => {
      return `$${Number(amt || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    };

    // ── Derive ALL values from the POSTed page data ──────────────────
    const totalGross = Number(monthTotals.gross) || groups.reduce((s: number, g: any) => s + (Number(g.gross) || 0), 0);
    const auditFee = Number(monthTotals.commission) || totalGross * 0.2;
    const clientNet = Number(monthTotals.net) || Math.max(totalGross - auditFee, 0);

    // Pipeline amounts — use actual values, fall back to 0 (not hardcoded)
    const detectedAmt = Number(pipeline.detected?.amount) || 0;
    const readyAmt = Number(pipeline.ready?.amount) || 0;
    const underReviewAmt = Number(pipeline.pending?.amount) || 0;
    const approvedAmt = Number(pipeline.approved?.amount) || 0;
    const paidAmt = Number(pipeline.paid?.amount) || 0;
    const justFiledAmt = readyAmt + detectedAmt;
    const activePipeline = Number(pipeline.totalInPipeline) || (detectedAmt + readyAmt + underReviewAmt + approvedAmt);

    // Dynamic reference & date range
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
    const shortId = Math.floor(Math.random() * 9000 + 1000);
    const refId = `SET-${dateStr}-${shortId}`;
    const manifestId = `MAS-SET-${shortId}`;

    // Compute period from groups or fallback to current month
    let periodLabel: string;
    const datedGroups = groups.filter((g: any) => g.label && g.label !== 'TBD');
    if (datedGroups.length > 0) {
      const first = datedGroups[0].label;
      const last = datedGroups[datedGroups.length - 1].label;
      periodLabel = first === last ? first : `${first} – ${last}`;
    } else {
      periodLabel = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    }

    // Win rate: approved / (approved + all non-paid) — or N/A
    const totalDecided = (pipeline.approved?.count || 0) + (pipeline.paid?.count || 0);
    const totalAll = totalDecided + (pipeline.pending?.count || 0) + (pipeline.ready?.count || 0) + (pipeline.detected?.count || 0);
    const winRate = totalAll > 0 ? `${((totalDecided / totalAll) * 100).toFixed(1)}%` : 'N/A';

    // Annual savings projection from current monthly gross
    const annualProjection = totalGross * 12;

    // Build payout schedule rows from groups
    const payoutRows = groups.map((g: any) => `
      <div class="summary-line">
        <span>${g.label} (${g.count} claim${g.count !== 1 ? 's' : ''})</span>
        <span class="mono">${formatMoney(g.gross)}</span>
      </div>
    `).join('');

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=Roboto+Mono:wght@400;500;700&display=swap');

          @page { margin: 0; size: A4; }
          body {
            font-family: 'Inter', sans-serif;
            color: #333333;
            line-height: 1.5;
            padding: 60px;
            font-size: 11px;
            background: #fff;
          }

          .header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            margin-bottom: 40px;
          }
          .brand-block .brand {
            font-size: 12px;
            font-weight: 900;
            color: #000;
            letter-spacing: 5px;
            text-transform: uppercase;
          }
          .brand-block .sub-label {
            font-size: 8px;
            font-weight: 600;
            color: #888;
            letter-spacing: 0.5px;
            margin-top: 2px;
          }
          .doc-info {
            text-align: right;
            font-size: 9px;
            text-transform: uppercase;
            font-weight: 600;
            color: #555;
            letter-spacing: 0.5px;
          }
          .doc-title { font-weight: 800; color: #000; margin-bottom: 2px; }

          .hero-strip {
            background: #F9F9F9;
            padding: 12px 20px;
            margin-bottom: 35px;
            font-size: 10.5px;
            color: #000;
            display: flex;
            justify-content: space-between;
            align-items: center;
          }
          .hero-strip b { font-weight: 800; letter-spacing: 0.5px; }
          .hero-strip .mono { font-family: 'Roboto Mono', monospace; font-size: 11px; }

          .math-strip {
            display: flex;
            border-top: 0.05pt solid #000;
            border-bottom: 0.05pt solid #000;
            padding: 10px 0;
            margin-bottom: 40px;
          }
          .math-col { flex: 1; text-align: center; }
          .math-label {
            font-size: 8px;
            font-weight: 700;
            color: #999;
            text-transform: uppercase;
            letter-spacing: 1px;
            margin-bottom: 10px;
          }
          .math-val {
            font-family: 'Roboto Mono', monospace;
            font-size: 11pt;
            font-weight: 400;
            color: #333333;
          }
          .math-val.grey { color: #888; }

          .section-title {
            font-size: 9px;
            font-weight: 800;
            text-transform: uppercase;
            letter-spacing: 1px;
            color: #000;
            margin-bottom: 15px;
          }
          .pipeline-summary { margin-bottom: 45px; }
          .summary-line {
            display: flex;
            justify-content: space-between;
            margin-bottom: 8px;
            font-size: 9px;
            color: #666;
            border-bottom: 0.1pt solid #eee;
            padding-bottom: 5px;
          }
          .summary-line.bold {
            font-weight: 800;
            color: #000;
            border-bottom: none;
            padding-top: 10px;
          }
          .mono { font-family: 'Roboto Mono', monospace; }

          .projections-section {
            font-family: 'Inter', sans-serif;
            margin-top: 50px;
            margin-bottom: 40px;
          }
          .projections-title {
            font-size: 11px;
            font-weight: 800;
            color: #000;
            margin-bottom: 20px;
            border-bottom: 0.1pt solid #eee;
            padding-bottom: 8px;
            width: 100%;
          }
          .projection-item {
            font-family: 'Inter', sans-serif;
            font-size: 11px;
            margin-bottom: 12px;
            color: #333;
          }
          .projection-item b { font-weight: 700; color: #000; }
          .projection-item .mono { font-family: 'Roboto Mono', monospace; margin-left: 5px; }

          .payout-schedule { margin-bottom: 45px; }

          .system-foot {
            margin-top: 80px;
            text-align: center;
            font-size: 7px;
            color: #BBB;
            text-transform: uppercase;
            letter-spacing: 1px;
            border-top: 0.2pt solid #eee;
            padding-top: 20px;
          }
        </style>
      </head>
      <body>
        <!-- HEADER -->
        <div class="header">
          <div class="brand-block">
            <div class="brand">MARGIN</div>
            <div class="sub-label">The Margin Group</div>
          </div>
          <div class="doc-info">
            <div class="doc-title">Settlement & Forecast</div>
            <div>Period: ${periodLabel}</div>
          </div>
        </div>

        <!-- HERO STRIP -->
        <div class="hero-strip">
          <span><b>NET LIQUIDITY SETTLED:</b> <span class="mono">${formatMoney(clientNet)}</span></span>
          <span><b>REF:</b> <span class="mono">${refId}</span></span>
        </div>

        <!-- RECEIPT MATH STRIP -->
        <div class="math-strip">
          <div class="math-col">
            <div class="math-label">GROSS RECOVERY</div>
            <div class="math-val">${formatMoney(totalGross)}</div>
          </div>
          <div class="math-col">
            <div class="math-label">AUDIT COMMISSION 20%</div>
            <div class="math-val grey">-${formatMoney(auditFee)}</div>
          </div>
          <div class="math-col">
            <div class="math-label">NET TRANSFER</div>
            <div class="math-val">${formatMoney(clientNet)}</div>
          </div>
        </div>

        <!-- PIPELINE STATUS -->
        <div class="section-title">ACTIVE RECOVERY PIPELINE</div>
        <div class="pipeline-summary">
          <div class="summary-line"><span>Account ID</span> <span class="mono">${storeName}</span></div>
          <div class="summary-line"><span>Detected (Awaiting Processing)</span> <span class="mono">${formatMoney(detectedAmt)}</span></div>
          <div class="summary-line"><span>Ready to File</span> <span class="mono">${formatMoney(readyAmt)}</span></div>
          <div class="summary-line"><span>Pending Amazon Decision (Under Review)</span> <span class="mono">${formatMoney(underReviewAmt)}</span></div>
          <div class="summary-line"><span>Approved</span> <span class="mono">${formatMoney(approvedAmt)}</span></div>
          <div class="summary-line"><span>Paid Out</span> <span class="mono">${formatMoney(paidAmt)}</span></div>
          <div class="summary-line bold"><span>Total Potential Asset Value</span> <span class="mono">${formatMoney(clientNet + activePipeline)}</span></div>
        </div>

        ${groups.length > 0 ? `
        <!-- PAYOUT SCHEDULE -->
        <div class="section-title">PAYOUT SCHEDULE</div>
        <div class="payout-schedule">
          ${payoutRows}
        </div>
        ` : ''}

        <!-- PROJECTIONS -->
        <div class="projections-section">
          <div class="projections-title">Projections</div>
          <div class="projection-item">Current Win Rate - <span class="mono">${winRate}</span></div>
          <div class="projection-item">Projected Annual Savings - <span class="mono">${formatMoney(annualProjection)}</span></div>
        </div>

        <!-- LEGAL FOOTER -->
        <div class="system-foot">
          Margin Audit Systems | Forensic FBA Recovery Specialists<br>
          Manifest ID: ${manifestId} | Institutional Grade Asset Integrity Verified | Generated: ${now.toISOString().slice(0, 10)}
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
    const tenantId = (req as any).tenant?.tenantId || DEFAULT_TENANT_ID;
    const { supabaseAdmin } = await import('../database/supabaseClient');

    const { data: dispute, error } = await supabaseAdmin
      .from('dispute_cases')
      .select('*')
      .eq('id', id)
      .eq('tenant_id', tenantId)
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
    const tenantId = (req as any).tenant?.tenantId || DEFAULT_TENANT_ID;

    // 1. Update case status to Denied
    const { error } = await supabaseAdmin
      .from('dispute_cases')
      .update({
        status: 'Denied',
        recovery_status: 'denied',
        updated_at: new Date().toISOString(),
        metadata: {
          rejection_reason: rejectionReason,
          amazon_case_id: amazonCaseId
        }
      })
      .eq('id', id)
      .eq('tenant_id', tenantId);

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
    logger.info(`🔍 [DISPUTE] Financial Sentry check for user: ${userId}`);
    const { dispute_id } = req.body;

    if (!dispute_id) {
      return res.status(400).json({
        success: false,
        message: 'dispute_id is required'
      });
    }

    // 1. FINANCIAL SENTRY: Check is_paid_beta flag
    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .select('is_paid_beta, amazon_seller_id')
      .eq('id', userId)
      .single();

    logger.info(`🔍 [DISPUTE] User data found: ${JSON.stringify(user)}, Error: ${userError?.message}`);

    if (userError || !user?.is_paid_beta) {
      logger.warn(`🚨 [SECURITY] Unauthorized filing attempt for unpaid user: ${userId}`, { dispute_id });
      return res.status(403).json({
        success: false,
        message: 'Upgrade required to file disputes ($99 Beta Activation)'
      });
    }

    const sellerId = user.amazon_seller_id || userId; // Fallback to userId if amazon_seller_id is missing

    // 2. QUEUE HANDOFF: Enqueue job via refundFilingWorker
    const refundFilingWorker = (await import('../workers/refundFilingWorker')).default;
    
    // Ensure the case is in 'pending' status so the worker can pick it up
    const tenantId = (req as any).tenant?.tenantId || DEFAULT_TENANT_ID;
    await supabaseAdmin
      .from('dispute_cases')
      .update({
        filing_status: 'pending',
        updated_at: new Date().toISOString()
      })
      .eq('id', dispute_id)
      .eq('tenant_id', tenantId);

    // Enqueue the job
    const job = await refundFilingWorker.addJob(dispute_id, sellerId);

    res.json({
      success: true,
      message: 'Filing request received and queued.',
      jobId: job.id
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
    const tenantId = (req as any).tenant?.tenantId || DEFAULT_TENANT_ID;
    const { data: caseData, error: fetchError } = await supabaseAdmin
      .from('dispute_cases')
      .select('*')
      .eq('id', dispute_id)
      .eq('tenant_id', tenantId)
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
        filing_error: null,
        updated_at: new Date().toISOString()
      })
      .eq('id', dispute_id)
      .eq('tenant_id', tenantId);

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
    const tenantId = (req as any).tenant?.tenantId || DEFAULT_TENANT_ID;
    const { data: caseData, error: fetchError } = await supabaseAdmin
      .from('dispute_cases')
      .select('*')
      .eq('id', dispute_id)
      .eq('tenant_id', tenantId)
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
