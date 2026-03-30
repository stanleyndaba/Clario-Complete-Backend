import logger from '../utils/logger';
import { supabaseAdmin } from '../database/supabaseClient';

const AGENT7_ALLOW_UNPAID_FILING_FLAG = 'AGENT7_ALLOW_UNPAID_FILING';

export type Agent7UnpaidFilingOverrideStage = 'route_gate' | 'submission_gate';

function normalizeFlag(value: string | undefined): string {
  return String(value || '').trim().toLowerCase();
}

export function isAgent7UnpaidFilingOverrideEnabled(): boolean {
  return normalizeFlag(process.env[AGENT7_ALLOW_UNPAID_FILING_FLAG]) === 'true';
}

export function warnIfAgent7UnpaidFilingOverrideEnabledOnBoot(): void {
  if (!isAgent7UnpaidFilingOverrideEnabled()) {
    return;
  }

  logger.warn('[AGENT 7] Unpaid filing override enabled', {
    event: 'UNPAID_FILING_OVERRIDE_BOOT',
    environment: process.env.NODE_ENV || process.env.ENV || 'unknown',
    flag: AGENT7_ALLOW_UNPAID_FILING_FLAG
  });
}

export async function recordAgent7UnpaidFilingOverride(params: {
  tenantId: string;
  disputeId: string;
  userId?: string | null;
  sellerId?: string | null;
  stage: Agent7UnpaidFilingOverrideStage;
}): Promise<void> {
  if (!isAgent7UnpaidFilingOverrideEnabled()) {
    return;
  }

  const metadata = {
    event: 'UNPAID_FILING_OVERRIDE',
    tenant_id: params.tenantId,
    dispute_id: params.disputeId,
    user_id: params.userId || null,
    seller_id: params.sellerId || null,
    stage: params.stage,
    environment: process.env.NODE_ENV || process.env.ENV || 'unknown',
    timestamp: new Date().toISOString()
  };

  logger.warn('[AGENT 7] Unpaid filing override used', metadata);

  const { error } = await supabaseAdmin.from('audit_logs').insert({
    tenant_id: params.tenantId,
    actor_user_id: params.userId || null,
    user_id: params.userId || null,
    actor_type: params.stage === 'submission_gate' ? 'worker' : 'user',
    action: 'agent7.unpaid_filing_override',
    event_type: 'UNPAID_FILING_OVERRIDE',
    resource_type: 'dispute_case',
    resource_id: params.disputeId,
    severity: 'low',
    metadata
  });

  if (error) {
    logger.error('Failed to persist unpaid filing override audit row', {
      error,
      metadata
    });
  }
}
