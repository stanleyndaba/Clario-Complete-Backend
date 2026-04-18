import { Router } from 'express';
import { optionalAuth } from '../middleware/authMiddleware';
import { supabaseAdmin, convertUserIdToUuid } from '../database/supabaseClient';
import logger from '../utils/logger';
import refundFilingWorker from '../workers/refundFilingWorker';
import { evaluateAndPersistCaseEligibility } from '../services/agent7EligibilityService';
import {
  deriveQueueActionTruth,
  type EligibilityStatus as QueueEligibilityStatus
} from '../services/disputeCaseQueueService';
import { createSellerHttpClient } from '../services/sellerHttpClient';
import proxyAssignmentService from '../services/proxyAssignmentService';
import amazonCaseThreadService from '../services/amazonCaseThreadService';
import {
  isAgent7UnpaidFilingOverrideEnabled,
  recordAgent7UnpaidFilingOverride
} from '../services/agent7UnpaidFilingOverride';

const router = Router();

// Routes still use optional auth at the router level, but dispute access itself is strict.
router.use(optionalAuth);

async function resolveDisputeScope(
  req: any,
  options?: {
    requiredRoles?: Array<'owner' | 'admin' | 'member' | 'viewer'>;
  }
) {
  const tenantSlug = String(req.query.tenantSlug || req.query.tenant_slug || '').trim() || null;
  const requestTenantId = String(req.tenant?.tenantId || '').trim() || null;
  const requestTenantSlug = String(req.tenant?.tenantSlug || '').trim() || null;
  const requestTenantRole = String(req.tenant?.userRole || '').trim() || null;
  const userId = String(req.userId || req.user?.id || '').trim() || null;
  const requiredRoles = Array.isArray(options?.requiredRoles) ? options!.requiredRoles : [];

  const assertRole = (role: string | null) => {
    if (!requiredRoles.length) return;
    if (!role || !requiredRoles.includes(role as 'owner' | 'admin' | 'member' | 'viewer')) {
      throw new Error('Owner or admin access required');
    }
  };

  if (requestTenantId && userId) {
    assertRole(requestTenantRole);
    return {
      tenantId: requestTenantId,
      tenantSlug: requestTenantSlug || tenantSlug,
      userId,
      userRole: requestTenantRole
    };
  }

  if (!tenantSlug) {
    throw new Error('Tenant context required');
  }

  if (!userId) {
    throw new Error('Tenant access requires authenticated user');
  }

  const { data: tenant, error: tenantError } = await supabaseAdmin
    .from('tenants')
    .select('id, slug')
    .eq('slug', tenantSlug)
    .is('deleted_at', null)
    .maybeSingle();

  if (tenantError) {
    throw new Error('Failed to resolve tenant context');
  }

  if (!tenant) {
    throw new Error('Tenant not found');
  }

  const safeUserId = convertUserIdToUuid(userId);
  const { data: membership, error: membershipError } = await supabaseAdmin
    .from('tenant_memberships')
    .select('id, role')
    .eq('tenant_id', tenant.id)
    .eq('user_id', safeUserId)
    .eq('is_active', true)
    .is('deleted_at', null)
    .maybeSingle();

  if (membershipError) {
    throw new Error('Failed to verify tenant membership');
  }

  if (!membership) {
    throw new Error('You do not have access to this tenant');
  }

  assertRole(String((membership as any).role || '').trim() || null);

  return {
    tenantId: tenant.id,
    tenantSlug: tenant.slug || tenantSlug,
    userId,
    userRole: (membership as any).role || null
  };
}

async function resolvePaidSellerIdentity(userId: string, tenantId: string, disputeId: string) {
  const { data: user, error } = await supabaseAdmin
    .from('users')
    .select('id, is_paid_beta, amazon_seller_id, billing_status, billing_unlocked_at, billing_source')
    .eq('id', userId)
    .single();

  if (error || !user) {
    throw new Error('User identity could not be resolved');
  }

  if (!user?.is_paid_beta && !isAgent7UnpaidFilingOverrideEnabled()) {
    throw new Error('Upgrade required to file disputes ($99 Beta Activation)');
  }

  if (!user?.is_paid_beta) {
    await recordAgent7UnpaidFilingOverride({
      tenantId,
      disputeId,
      userId,
      sellerId: user.amazon_seller_id || userId,
      stage: 'route_gate'
    });
  }

  return {
    sellerId: user.amazon_seller_id || userId,
    user
  };
}

async function resolveSellerIdentity(userId: string) {
  const { data: user, error } = await supabaseAdmin
    .from('users')
    .select('id, is_paid_beta, amazon_seller_id, billing_status, billing_unlocked_at, billing_source')
    .eq('id', userId)
    .single();

  if (error || !user) {
    throw new Error('User identity could not be resolved');
  }

  return {
    sellerId: user.amazon_seller_id || userId,
    user
  };
}

function getDisputeRouteStatusCode(error: any) {
  const message = String(error?.message || '');

  if (
    message.includes('Tenant context required') ||
    message.includes('Tenant not found')
  ) {
    return 400;
  }

  if (
    message.includes('authenticated user') ||
    message.includes('access') ||
    message.includes('Upgrade required')
  ) {
    return 403;
  }

  if (message.includes('not found')) {
    return 404;
  }

  return 500;
}

type FilingRouteAction = 'file-now' | 'retry-filing' | 'approve-filing';

function normalizeDisputeRouteValue(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

function buildCanonicalRouteActionTruth(
  disputeId: string,
  filingStatus: unknown,
  eligibleToFile: boolean | null | undefined,
  eligibilityStatus: QueueEligibilityStatus | null | undefined
) {
  return deriveQueueActionTruth({
    entity_type: 'dispute_case',
    has_real_dispute_case: true,
    linked_dispute_case_id: disputeId,
    filing_status: String(filingStatus || ''),
    eligible_to_file: eligibleToFile === true,
    eligibility_status: eligibilityStatus ?? null
  });
}

function buildEvaluatedRouteActionTruth(
  disputeId: string,
  disputeCase: any,
  eligibilityStatus: QueueEligibilityStatus | null | undefined
) {
  const filingStatus = disputeCase?.filing_status || 'blocked';
  const eligibleToFile = disputeCase?.eligible_to_file === true && eligibilityStatus === 'READY';
  const actionTruth = buildCanonicalRouteActionTruth(
    disputeId,
    filingStatus,
    eligibleToFile,
    eligibilityStatus
  );

  return {
    filingStatus,
    eligibleToFile,
    actionTruth
  };
}

function getRouteBlockReasons(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean);
  }

  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item || '').trim()).filter(Boolean);
      }
    } catch {
      return [value.trim()];
    }
  }

  return [];
}

function isStaleOperationalQueueHold(caseData: any): boolean {
  const filingStatus = normalizeDisputeRouteValue(caseData?.filing_status);
  const eligibilityStatus = String(caseData?.eligibility_status || '').trim().toUpperCase();
  const eligibleToFile = caseData?.eligible_to_file === true;
  const blockReasons = getRouteBlockReasons(caseData?.block_reasons);
  const lastError = normalizeDisputeRouteValue(caseData?.last_error);

  if (
    filingStatus !== 'pending' ||
    eligibilityStatus !== 'SAFETY_HOLD' ||
    eligibleToFile ||
    blockReasons.length > 0 ||
    !lastError
  ) {
    return false;
  }

  const hasOperationalQueueSignature =
    lastError.includes('redis_quota_exceeded') ||
    lastError.includes('dispatch queue cannot safely accept more work') ||
    lastError.includes('filing_queue_gate') ||
    lastError.includes('queue_waiting_limit_reached') ||
    lastError.includes('queue_age_limit_reached');

  return hasOperationalQueueSignature;
}

async function isFilingQueueHealthyForStaleRecovery(disputeId: string): Promise<boolean> {
  try {
    const metrics = await refundFilingWorker.getSubmissionQueueMetrics();
    const healthy = metrics.available === true && !metrics.reason;

    if (!healthy) {
      logger.info('[AGENT 7] Stale queue-hold recovery skipped because filing queue is not healthy', {
        disputeId,
        queueAvailable: metrics.available,
        queueReason: metrics.reason || null,
        waiting: metrics.waiting,
        active: metrics.active,
        delayed: metrics.delayed
      });
    }

    return healthy;
  } catch (error: any) {
    logger.warn('[AGENT 7] Stale queue-hold recovery skipped because queue metrics failed', {
      disputeId,
      error: error?.message || String(error)
    });
    return false;
  }
}

function isFreshRouteActionAllowed(
  action: FilingRouteAction,
  actionTruth: ReturnType<typeof buildCanonicalRouteActionTruth>
) {
  if (action === 'file-now') {
    return actionTruth.can_file;
  }

  if (action === 'retry-filing') {
    return actionTruth.can_retry || actionTruth.can_file;
  }

  if (action === 'approve-filing') {
    return actionTruth.can_approve || actionTruth.can_file;
  }

  return false;
}

function buildRouteActionConflictPayload(params: {
  action: FilingRouteAction;
  currentFilingStatus: unknown;
  evaluatedFilingStatus?: unknown;
  eligibilityStatus: QueueEligibilityStatus | null | undefined;
  reasons: string[];
  actionTruth: ReturnType<typeof buildCanonicalRouteActionTruth>;
}) {
  const currentStatus = String(params.currentFilingStatus || 'unknown');
  const normalizedCurrentStatus = normalizeDisputeRouteValue(params.currentFilingStatus);
  const evaluatedStatus = String(params.evaluatedFilingStatus || params.currentFilingStatus || 'blocked');

  let message = 'Case cannot enter the filing queue.';

  if (params.action === 'file-now') {
    message = params.eligibilityStatus !== 'READY'
      ? 'Case is blocked and cannot be filed'
      : `Case is not queueable from filing state: ${currentStatus}`;
  } else if (params.action === 'retry-filing') {
    message = normalizedCurrentStatus !== 'failed'
      ? `Case is not retryable from filing state: ${currentStatus}`
      : 'Case is blocked and cannot be retried';
  } else if (params.action === 'approve-filing') {
    message = normalizedCurrentStatus !== 'pending_approval'
      ? `Case is not pending approval (current status: ${currentStatus})`
      : 'Case remains blocked after approval review';
  }

  return {
    success: false,
    message,
    filing_status: evaluatedStatus,
    eligibility_status: params.eligibilityStatus || null,
    block_reasons: params.reasons,
    actionability: {
      can_file: params.actionTruth.can_file,
      can_retry: params.actionTruth.can_retry,
      can_approve: params.actionTruth.can_approve
    }
  };
}

function hasTrustedInternalApiKey(req: any): boolean {
  const configuredKey = process.env.INTERNAL_API_KEY;
  if (!configuredKey || configuredKey.trim().length === 0) {
    return false;
  }

  const providedKey = req.headers['x-internal-api-key'] || req.headers['x-api-key'];
  return typeof providedKey === 'string' && providedKey === configuredKey;
}

function classifyProxyEnvVar(name: string, value?: string | null): {
  name: string;
  state: 'present_and_usable' | 'present_but_malformed' | 'missing' | 'ignored_by_code_path';
  detail: string;
} {
  const trimmed = typeof value === 'string' ? value.trim() : '';

  if (name === 'PROXY_PASSWORD' || name === 'PROXY_USERNAME') {
    return trimmed
      ? {
          name,
          state: 'present_and_usable',
          detail: `${name} is present`
        }
      : {
          name,
          state: 'missing',
          detail: `${name} is missing`
        };
  }

  if (name === 'ENABLE_PROXY_ROUTING') {
    if (!trimmed) {
      return {
        name,
        state: 'missing',
        detail: 'ENABLE_PROXY_ROUTING is missing and code treats proxy routing as disabled'
      };
    }

    return trimmed === 'true'
      ? {
          name,
          state: 'present_and_usable',
          detail: 'ENABLE_PROXY_ROUTING=true'
        }
      : {
          name,
          state: 'present_but_malformed',
          detail: `ENABLE_PROXY_ROUTING=${trimmed} (code requires literal true)`
        };
  }

  if (name === 'PROXY_PORT') {
    if (!trimmed) {
      return {
          name,
          state: 'missing',
          detail: 'PROXY_PORT is missing and code falls back to 22225'
        };
    }

    return Number.isFinite(Number(trimmed))
      ? {
          name,
          state: 'present_and_usable',
          detail: `PROXY_PORT=${trimmed}`
        }
      : {
          name,
          state: 'present_but_malformed',
          detail: `PROXY_PORT=${trimmed} is not numeric`
        };
  }

  if (!trimmed) {
    return {
      name,
      state: 'missing',
      detail: `${name} is missing and code uses its default`
    };
  }

  return {
    name,
    state: 'present_and_usable',
    detail: `${name}=${trimmed}`
  };
}

function countOccurrences(value: string, token: string): number {
  if (!value || !token) return 0;
  return value.split(token).length - 1;
}

router.get('/proxy-runtime-check', async (req, res) => {
  try {
    if (!hasTrustedInternalApiKey(req)) {
      return res.status(403).json({
        success: false,
        message: 'Trusted internal API key required'
      });
    }

    const sellerId = String(req.query.seller_id || '').trim();
    if (!sellerId) {
      return res.status(400).json({
        success: false,
        message: 'seller_id is required'
      });
    }

    const proxyEnvAudit = {
      ENABLE_PROXY_ROUTING: classifyProxyEnvVar('ENABLE_PROXY_ROUTING', process.env.ENABLE_PROXY_ROUTING),
      PROXY_PROVIDER: classifyProxyEnvVar('PROXY_PROVIDER', process.env.PROXY_PROVIDER),
      PROXY_HOST: classifyProxyEnvVar('PROXY_HOST', process.env.PROXY_HOST),
      PROXY_PORT: classifyProxyEnvVar('PROXY_PORT', process.env.PROXY_PORT),
      PROXY_USERNAME: classifyProxyEnvVar('PROXY_USERNAME', process.env.PROXY_USERNAME),
      PROXY_PASSWORD: classifyProxyEnvVar('PROXY_PASSWORD', process.env.PROXY_PASSWORD),
      PROXY_COUNTRY: classifyProxyEnvVar('PROXY_COUNTRY', process.env.PROXY_COUNTRY)
    };

    const { data: assignment } = await supabaseAdmin
      .from('seller_proxy_assignments')
      .select('id, seller_id, proxy_session_id, proxy_provider, proxy_region, status, tenant_id, created_at, updated_at')
      .eq('seller_id', sellerId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const envUsername = String(process.env.PROXY_USERNAME || '').trim();
    let proxyResolution: Record<string, any>;
    let usernameShape: Record<string, any> = {
      envHasSessionToken: envUsername.includes('-session-'),
      envHasCountryToken: envUsername.includes('-country-'),
      resolvedSessionTokenCount: 0,
      resolvedCountryTokenCount: 0
    };
    try {
      const resolvedProxy = await proxyAssignmentService.getProxyForSeller(sellerId);
      const resolvedUsername = String(resolvedProxy?.username || '');
      usernameShape = {
        ...usernameShape,
        resolvedSessionTokenCount: countOccurrences(resolvedUsername, '-session-'),
        resolvedCountryTokenCount: countOccurrences(resolvedUsername, '-country-')
      };
      proxyResolution = {
        ok: true,
        config: resolvedProxy
          ? {
              host: resolvedProxy.host,
              port: resolvedProxy.port,
              protocol: resolvedProxy.protocol,
              sessionId: resolvedProxy.sessionId,
              usernamePreview: `${String(resolvedProxy.username || '').slice(0, 12)}...`
            }
          : null
      };
    } catch (error: any) {
      proxyResolution = {
        ok: false,
        error: error?.message || String(error)
      };
    }

    let clientInitialization: Record<string, any>;
    try {
      const client = createSellerHttpClient(sellerId);
      await (client as any).initialize();
      clientInitialization = {
        ok: true,
        proxyInfo: client.getProxyInfo()
      };
    } catch (error: any) {
      clientInitialization = {
        ok: false,
        error: error?.message || String(error)
      };
    }

    return res.json({
      success: true,
      seller_id: sellerId,
      runtime_config: proxyAssignmentService.getConfigSummary(),
      env_audit: proxyEnvAudit,
      username_shape: usernameShape,
      assignment: assignment || null,
      proxy_resolution: proxyResolution,
      client_initialization: clientInitialization
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error?.message || 'Failed to inspect proxy runtime'
    });
  }
});

router.get('/', async (req, res) => {
  try {
    const { tenantId } = await resolveDisputeScope(req as any);
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
      claim_id: c.detection_result_id || null,
      amazon_case_id: c.amazon_case_id || null,
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
    const message = String(error?.message || '');
    res.status(getDisputeRouteStatusCode(error)).json({
      success: false,
      message: message || 'Internal server error'
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
    const { tenantId } = await resolveDisputeScope(req as any);
    const { data: disputeCase, error: caseError } = await supabaseAdmin
      .from('dispute_cases')
      .select('id')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (caseError) throw caseError;
    if (!disputeCase) {
      return res.status(404).json({
        success: false,
        message: 'Dispute case not found'
      });
    }

    const disputeService = (await import('../services/disputeService')).default;

    const pdfBuffer = await disputeService.generateDisputeBrief(id);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=dispute-brief-${id}.pdf`);
    res.send(pdfBuffer);
  } catch (error: any) {
    console.error('[dispute-brief] Error:', error);
    res.status(getDisputeRouteStatusCode(error)).json({
      success: false,
      message: error?.message || 'Internal server error'
    });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { tenantId } = await resolveDisputeScope(req as any);

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
        claimId: dispute.detection_result_id || null,
        createdAt: dispute.created_at,
        updatedAt: dispute.updated_at,
        recoveryStatus: dispute.recovery_status,
        actualPayoutAmount: dispute.actual_payout_amount,
        billingStatus: dispute.billing_status,
        billingTransactionId: dispute.billing_transaction_id,
        platformFeeCents: dispute.platform_fee_cents,
        billedAt: dispute.billed_at,
        amazon_case_id: dispute.amazon_case_id || null
      }
    });
  } catch (error: any) {
    const message = String(error?.message || '');
    const statusCode = getDisputeRouteStatusCode(error);
    res.status(statusCode).json({
      success: false,
      message: message || 'Internal server error'
    });
  }
});

router.post('/backfill-amazon-thread-link', async (req, res) => {
  try {
    const { tenantId, userId } = await resolveDisputeScope(req as any, {
      requiredRoles: ['owner', 'admin']
    });

    const unmatchedCaseMessageId = String(
      req.body?.unmatched_case_message_id ||
      req.body?.unmatchedCaseMessageId ||
      ''
    ).trim();
    const targetDisputeCaseId = String(
      req.body?.target_dispute_case_id ||
      req.body?.targetDisputeCaseId ||
      ''
    ).trim() || null;
    const createPlaceholder = req.body?.create_placeholder === true || req.body?.createPlaceholder === true;
    const targetUserId = String(req.body?.target_user_id || req.body?.targetUserId || '').trim() || null;

    if (!unmatchedCaseMessageId) {
      return res.status(400).json({
        success: false,
        message: 'unmatched_case_message_id is required'
      });
    }

    if (!targetDisputeCaseId && !createPlaceholder) {
      return res.status(400).json({
        success: false,
        message: 'Provide target_dispute_case_id or set create_placeholder=true'
      });
    }

    if (targetDisputeCaseId && createPlaceholder) {
      return res.status(400).json({
        success: false,
        message: 'Choose either target_dispute_case_id or create_placeholder=true'
      });
    }

    const result = await amazonCaseThreadService.backfillAmazonThreadLink({
      tenantId,
      actorUserId: userId,
      unmatchedCaseMessageId,
      targetDisputeCaseId,
      createPlaceholder,
      targetUserId
    });

    return res.json({
      success: true,
      message: result.placeholderCreated
        ? 'Amazon thread linked through placeholder dispute case'
        : 'Amazon thread linked to dispute case',
      dispute_case_id: result.disputeCaseId,
      case_message_id: result.caseMessageId,
      amazon_case_id: result.amazonCaseId,
      placeholder_created: result.placeholderCreated,
      link_status: result.linkStatus,
      case_state: result.caseState
    });
  } catch (error: any) {
    const message = String(error?.message || 'Failed to backfill Amazon thread link');
    const statusCode =
      message.includes('required') || message.includes('Provide') || message.includes('Choose either')
        ? 400
        : (
            message.includes('not found')
          )
            ? 404
            : (
                message.includes('access') ||
                message.includes('belong to this tenant')
              )
                ? 403
                : (
                    message.includes('already linked') ||
                    message.includes('different amazon_case_id') ||
                    message.includes('linked to a different dispute case')
                  )
                    ? 409
                    : getDisputeRouteStatusCode(error);

    return res.status(statusCode).json({
      success: false,
      message
    });
  }
});

router.post('/', async (_req, res) => {
  return res.status(501).json({
    success: false,
    message: 'Direct dispute creation is not supported on this route. Dispute cases must be created from real detections and evidence matching.'
  });
});

router.post('/:id/submit', async (_req, res) => {
  return res.status(410).json({
    success: false,
    message: 'Legacy direct submit is disabled. Use the real Agent 7 filing queue instead.'
  });
});

router.post('/:id/reply', async (req, res) => {
  try {
    const { id } = req.params;
    const { tenantId, userId } = await resolveDisputeScope(req as any);
    const message = String(req.body?.message || '').trim();
    const attachmentDocumentIds = Array.isArray(req.body?.attachment_document_ids)
      ? req.body.attachment_document_ids
      : (Array.isArray(req.body?.attachmentDocumentIds) ? req.body.attachmentDocumentIds : []);

    if (!message) {
      return res.status(400).json({
        success: false,
        message: 'Reply message is required'
      });
    }

    const result = await amazonCaseThreadService.sendCaseReply({
      tenantId,
      userId,
      disputeCaseId: id,
      message,
      attachmentDocumentIds
    });

    return res.json({
      success: true,
      message: 'Reply sent successfully',
      provider_message_id: result.messageId,
      provider_thread_id: result.threadId,
      case_message_id: result.caseMessageId
    });
  } catch (error: any) {
    const message = String(error?.message || 'Failed to send case reply');
    const statusCode =
      message.includes('required')
        ? 400
        : (
            message.includes('permission') ||
            message.includes('Reconnect Gmail')
          )
            ? 403
            : (
            message.includes('linked') ||
            message.includes('existing Amazon thread message') ||
            message.includes('could not be resolved') ||
            message.includes('must be linked')
          )
            ? 409
            : getDisputeRouteStatusCode(error);

    return res.status(statusCode).json({
      success: false,
      message
    });
  }
});

router.get('/:id/audit-log', async (req, res) => {
  try {
    const { id } = req.params;
    const { tenantId } = await resolveDisputeScope(req as any);

    const { data: disputeCase, error: caseError } = await supabaseAdmin
      .from('dispute_cases')
      .select('id')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (caseError) throw caseError;
    if (!disputeCase) {
      return res.status(404).json({
        success: false,
        message: 'Dispute case not found'
      });
    }

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
    res.status(getDisputeRouteStatusCode(error)).json({
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
    const { tenantId } = await resolveDisputeScope(req as any);
    const { resolution_status, resolution_notes, resolution_amount } = req.body || {};
    const timestamp = new Date().toISOString();
    const { data: updatedCase, error } = await supabaseAdmin
      .from('dispute_cases')
      .update({
        status: resolution_status || 'resolved',
        resolution_notes,
        resolution_amount,
        updated_at: timestamp
      })
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select('*')
      .maybeSingle();

    if (error) throw error;
    if (!updatedCase) {
      return res.status(404).json({
        success: false,
        message: 'Dispute case not found'
      });
    }

    res.json({
      success: true,
      message: 'Dispute case resolved successfully',
      dispute: updatedCase
    });
  } catch (error: any) {
    res.status(getDisputeRouteStatusCode(error)).json({
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
    const { tenantId, userId } = await resolveDisputeScope(req as any);
    const { rejectionReason, amazonCaseId } = req.body;

    const learningWorker = (await import('../workers/learningWorker')).default;

    // 1. Update case status to Denied
    const { error } = await supabaseAdmin
      .from('dispute_cases')
      .update({
        status: 'rejected',
        filing_status: 'failed',
        recovery_status: 'denied',
        rejection_reason: rejectionReason || 'Unknown rejection',
        rejected_at: new Date().toISOString(),
        last_error: rejectionReason || 'Unknown rejection',
        amazon_case_id: amazonCaseId || null,
        updated_at: new Date().toISOString(),
        eligible_to_file: false,
        block_reasons: rejectionReason ? ['rejected_by_amazon'] : ['rejected_without_reason']
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
    notificationHelper.notifyAmazonChallenge(userId, { tenantId, disputeIds: [id] }).catch((err: any) => {
      console.error('Failed to notify Amazon challenge:', err);
    });

    res.json({
      success: true,
      message: 'Case denied and logged for learning'
    });

  } catch (error: any) {
    res.status(getDisputeRouteStatusCode(error)).json({
      success: false,
      message: error?.message || 'Internal server error'
    });
  }
});

// POST /api/disputes/file-now
// Trigger immediate filing for a pending case (Agent 7 manual trigger)
router.post('/file-now', async (req, res) => {
  try {
    const { tenantId, userId } = await resolveDisputeScope(req as any);
    logger.info(`🔍 [DISPUTE] Financial Sentry check for user: ${userId}`);
    const { dispute_id } = req.body;

    if (!dispute_id) {
      return res.status(400).json({
        success: false,
        message: 'dispute_id is required'
      });
    }

    await resolvePaidSellerIdentity(userId, tenantId, dispute_id);
    const { data: caseData, error: fetchError } = await supabaseAdmin
      .from('dispute_cases')
      .select('id, filing_status, seller_id, eligibility_status, eligible_to_file, block_reasons, last_error')
      .eq('id', dispute_id)
      .eq('tenant_id', tenantId)
      .single();

    if (fetchError || !caseData) {
      return res.status(404).json({
        success: false,
        message: 'Dispute case not found'
      });
    }

    const caseSellerId = String(caseData.seller_id || '').trim();
    if (!caseSellerId) {
      return res.status(409).json({
        success: false,
        message: 'Case is missing canonical seller linkage',
        filing_status: caseData.filing_status || 'unknown'
      });
    }

    const storedActionTruth = buildCanonicalRouteActionTruth(
      dispute_id,
      caseData.filing_status,
      caseData.eligible_to_file,
      caseData.eligibility_status
    );

    let evaluatedEligibility: Awaited<ReturnType<typeof evaluateAndPersistCaseEligibility>> | null = null;

    if (!storedActionTruth.can_file) {
      const shouldRecoverStaleQueueHold =
        isStaleOperationalQueueHold(caseData) &&
        await isFilingQueueHealthyForStaleRecovery(dispute_id);

      if (shouldRecoverStaleQueueHold) {
        logger.info('[AGENT 7] Re-evaluating stale queue-hold case before file-now rejection', {
          disputeId: dispute_id,
          tenantId,
          previousFilingStatus: caseData.filing_status,
          previousEligibilityStatus: caseData.eligibility_status
        });
        evaluatedEligibility = await evaluateAndPersistCaseEligibility(dispute_id, tenantId);
      } else {
        return res.status(409).json(buildRouteActionConflictPayload({
          action: 'file-now',
          currentFilingStatus: caseData.filing_status,
          eligibilityStatus: caseData.eligibility_status,
          reasons: getRouteBlockReasons(caseData.block_reasons),
          actionTruth: storedActionTruth
        }));
      }
    }

    const { reasons, disputeCase, eligibilityStatus } =
      evaluatedEligibility || await evaluateAndPersistCaseEligibility(dispute_id, tenantId);
    const evaluatedTruth = buildEvaluatedRouteActionTruth(dispute_id, disputeCase, eligibilityStatus);
    const { actionTruth } = evaluatedTruth;

    if (!actionTruth.can_file) {
      return res.status(409).json(buildRouteActionConflictPayload({
        action: 'file-now',
        currentFilingStatus: evaluatedTruth.filingStatus,
        evaluatedFilingStatus: evaluatedTruth.filingStatus,
        eligibilityStatus,
        reasons,
        actionTruth
      }));
    }

    const { error: updateError } = await supabaseAdmin
      .from('dispute_cases')
      .update({
        filing_status: 'pending',
        eligibility_status: 'READY',
        eligible_to_file: true,
        block_reasons: [],
        last_error: null,
        updated_at: new Date().toISOString()
      })
      .eq('id', dispute_id)
      .eq('tenant_id', tenantId);

    if (updateError) {
      throw updateError;
    }

    const job = await refundFilingWorker.addJob(dispute_id, caseSellerId);
    const queued = job.mode === 'queued';
    const blocked = job.mode === 'blocked';

    if (blocked) {
      const { data: latestCase } = await supabaseAdmin
        .from('dispute_cases')
        .select('filing_status, block_reasons, last_error')
        .eq('id', dispute_id)
        .eq('tenant_id', tenantId)
        .maybeSingle();

      return res.status(409).json({
        success: false,
        message: latestCase?.last_error || 'Case is blocked and could not enter filing.',
        filing_status: latestCase?.filing_status || 'blocked',
        block_reasons: Array.isArray(latestCase?.block_reasons) ? latestCase?.block_reasons : []
      });
    }

    res.json({
      success: true,
      message: 'Case queued for filing.',
      jobId: job.id,
      filing_status: 'pending',
      queued,
      blocked: false,
      mode: job.mode
    });

  } catch (error: any) {
    console.error('[file-now] Error:', error);
    const message = String(error?.message || '');
    const statusCode = getDisputeRouteStatusCode(error);
    res.status(statusCode).json({
      success: false,
      message: message || 'Internal server error'
    });
  }
});

// POST /api/disputes/retry-filing
// Retry a failed filing with stronger evidence (Agent 7 retry)
router.post('/retry-filing', async (req, res) => {
  try {
    const { tenantId, userId } = await resolveDisputeScope(req as any);
    const { dispute_id } = req.body;

    if (!dispute_id) {
      return res.status(400).json({
        success: false,
        message: 'dispute_id is required'
      });
    }

    await resolvePaidSellerIdentity(userId, tenantId, dispute_id);
    const { data: caseData, error: fetchError } = await supabaseAdmin
      .from('dispute_cases')
      .select('id, filing_status, seller_id, retry_count, eligibility_status, eligible_to_file, block_reasons')
      .eq('id', dispute_id)
      .eq('tenant_id', tenantId)
      .single();

    if (fetchError || !caseData) {
      return res.status(404).json({
        success: false,
        message: 'Dispute case not found'
      });
    }

    const caseSellerId = String(caseData.seller_id || '').trim();
    if (!caseSellerId) {
      return res.status(409).json({
        success: false,
        message: 'Case is missing canonical seller linkage',
        filing_status: caseData.filing_status || 'unknown'
      });
    }

    const storedActionTruth = buildCanonicalRouteActionTruth(
      dispute_id,
      caseData.filing_status,
      caseData.eligible_to_file,
      caseData.eligibility_status
    );
    const isRetryableState = normalizeDisputeRouteValue(caseData.filing_status) === 'failed';

    if (!isRetryableState || !storedActionTruth.can_retry) {
      return res.status(409).json(buildRouteActionConflictPayload({
        action: 'retry-filing',
        currentFilingStatus: caseData.filing_status,
        eligibilityStatus: caseData.eligibility_status,
        reasons: Array.isArray(caseData.block_reasons) ? caseData.block_reasons : [],
        actionTruth: storedActionTruth
      }));
    }

    const { reasons, disputeCase, eligibilityStatus } = await evaluateAndPersistCaseEligibility(dispute_id, tenantId);
    const evaluatedTruth = buildEvaluatedRouteActionTruth(dispute_id, disputeCase, eligibilityStatus);
    const { actionTruth } = evaluatedTruth;

    if (!isFreshRouteActionAllowed('retry-filing', actionTruth)) {
      return res.status(409).json(buildRouteActionConflictPayload({
        action: 'retry-filing',
        currentFilingStatus: evaluatedTruth.filingStatus,
        evaluatedFilingStatus: evaluatedTruth.filingStatus,
        eligibilityStatus,
        reasons,
        actionTruth
      }));
    }

    const newRetryCount = Number(caseData.retry_count || 0) + 1;
    const { error: updateError } = await supabaseAdmin
      .from('dispute_cases')
      .update({
        filing_status: 'retrying',
        eligibility_status: 'READY',
        retry_count: newRetryCount,
        last_error: null,
        eligible_to_file: true,
        block_reasons: [],
        updated_at: new Date().toISOString()
      })
      .eq('id', dispute_id)
      .eq('tenant_id', tenantId);

    if (updateError) {
      throw updateError;
    }

    const job = await refundFilingWorker.addJob(dispute_id, caseSellerId);
    const queued = job.mode === 'queued';
    const blocked = job.mode === 'blocked';

    if (blocked) {
      const { data: latestCase } = await supabaseAdmin
        .from('dispute_cases')
        .select('filing_status, block_reasons, last_error')
        .eq('id', dispute_id)
        .eq('tenant_id', tenantId)
        .maybeSingle();

      return res.status(409).json({
        success: false,
        message: latestCase?.last_error || 'Retry is blocked and could not enter filing.',
        filing_status: latestCase?.filing_status || 'blocked',
        block_reasons: Array.isArray(latestCase?.block_reasons) ? latestCase?.block_reasons : []
      });
    }

    res.json({
      success: true,
      message: 'Retry queued for filing',
      jobId: job.id,
      dispute_id,
      filing_status: 'retrying',
      retry_count: newRetryCount,
      queued,
      blocked: false,
      mode: job.mode
    });

  } catch (error: any) {
    console.error('[retry-filing] Error:', error);
    const message = String(error?.message || '');
    const statusCode = getDisputeRouteStatusCode(error);
    res.status(statusCode).json({
      success: false,
      message: message || 'Internal server error'
    });
  }
});

// POST /api/disputes/approve-filing
// Approve a high-value claim that was flagged for manual review (Agent 7 approval)
router.post('/approve-filing', async (req, res) => {
  try {
    const { tenantId, userId } = await resolveDisputeScope(req as any);
    const { dispute_id } = req.body;

    if (!dispute_id) {
      return res.status(400).json({
        success: false,
        message: 'dispute_id is required'
      });
    }

    await resolvePaidSellerIdentity(userId, tenantId, dispute_id);
    const { data: caseData, error: fetchError } = await supabaseAdmin
      .from('dispute_cases')
      .select('id, filing_status, seller_id, eligibility_status, eligible_to_file, block_reasons')
      .eq('id', dispute_id)
      .eq('tenant_id', tenantId)
      .single();

    if (fetchError || !caseData) {
      return res.status(404).json({
        success: false,
        message: 'Dispute case not found'
      });
    }

    const caseSellerId = String(caseData.seller_id || '').trim();
    if (!caseSellerId) {
      return res.status(409).json({
        success: false,
        message: 'Case is missing canonical seller linkage',
        filing_status: caseData.filing_status || 'unknown'
      });
    }

    const storedActionTruth = buildCanonicalRouteActionTruth(
      dispute_id,
      caseData.filing_status,
      caseData.eligible_to_file,
      caseData.eligibility_status
    );

    if (!storedActionTruth.can_approve) {
      return res.status(409).json(buildRouteActionConflictPayload({
        action: 'approve-filing',
        currentFilingStatus: caseData.filing_status,
        eligibilityStatus: caseData.eligibility_status,
        reasons: Array.isArray(caseData.block_reasons) ? caseData.block_reasons : [],
        actionTruth: storedActionTruth
      }));
    }

    const { reasons, disputeCase, eligibilityStatus } = await evaluateAndPersistCaseEligibility(dispute_id, tenantId);
    const evaluatedTruth = buildEvaluatedRouteActionTruth(dispute_id, disputeCase, eligibilityStatus);
    const { actionTruth } = evaluatedTruth;

    if (!isFreshRouteActionAllowed('approve-filing', actionTruth)) {
      return res.status(409).json(buildRouteActionConflictPayload({
        action: 'approve-filing',
        currentFilingStatus: evaluatedTruth.filingStatus,
        evaluatedFilingStatus: evaluatedTruth.filingStatus,
        eligibilityStatus,
        reasons,
        actionTruth
      }));
    }

    const { error: updateError } = await supabaseAdmin
      .from('dispute_cases')
      .update({
        filing_status: 'pending',
        eligibility_status: 'READY',
        eligible_to_file: true,
        block_reasons: [],
        last_error: null,
        updated_at: new Date().toISOString()
      })
      .eq('id', dispute_id)
      .eq('tenant_id', tenantId);

    if (updateError) {
      throw updateError;
    }

    console.log(`[approve-filing] User ${userId} approved claim ${dispute_id}`);

    const job = await refundFilingWorker.addJob(dispute_id, caseSellerId);
    const queued = job.mode === 'queued';
    const blocked = job.mode === 'blocked';

    if (blocked) {
      const { data: latestCase } = await supabaseAdmin
        .from('dispute_cases')
        .select('filing_status, block_reasons, last_error')
        .eq('id', dispute_id)
        .eq('tenant_id', tenantId)
        .maybeSingle();

      return res.status(409).json({
        success: false,
        message: latestCase?.last_error || 'Approved claim is blocked and could not enter filing.',
        filing_status: latestCase?.filing_status || 'blocked',
        block_reasons: Array.isArray(latestCase?.block_reasons) ? latestCase?.block_reasons : []
      });
    }

    res.json({
      success: true,
      message: 'Claim approved and queued for filing',
      dispute_id,
      filing_status: 'pending',
      approved_by: userId,
      jobId: job.id,
      queued,
      blocked: false,
      mode: job.mode
    });

  } catch (error: any) {
    console.error('[approve-filing] Error:', error);
    const message = String(error?.message || '');
    const statusCode = getDisputeRouteStatusCode(error);
    res.status(statusCode).json({
      success: false,
      message: message || 'Internal server error'
    });
  }
});


export default router;
