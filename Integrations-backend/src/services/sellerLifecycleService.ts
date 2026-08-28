import auditIntentService, { AuditIntentRecord, getSafeAuditIntentReturnPath } from './auditIntentService';
import auditRunService from './auditRunService';
import workspaceEntitlementService from './workspaceEntitlementService';
import {
  AmazonConnectionTruth,
  getAuthoritativeAmazonConnectionTruth,
  toAmazonLifecycleStatus,
} from './amazonConnectionTruthService';

export type SellerLifecycleAuditStatus =
  | 'created'
  | 'amazon_connection_required'
  | 'syncing'
  | 'detecting'
  | 'completed'
  | 'failed'
  | null;

export type SellerLifecycleContinuationKind =
  | 'audit_intent'
  | 'audit'
  | 'workspace'
  | 'audit_default';

export interface SellerLifecycleResolution {
  tenant: {
    id: string;
    slug: string;
  };
  continuation: {
    kind: SellerLifecycleContinuationKind;
    destination: string;
    audit_id: string | null;
    audit_status: SellerLifecycleAuditStatus;
    intent_id: string | null;
  };
  amazon: {
    connected: boolean;
    needs_reconnect: boolean;
    status: 'connected' | 'connection_required' | 'reconnect_required' | 'unavailable' | 'error';
    error_code: string | null;
    error_message: string | null;
  };
  entitlement: {
    entitled: boolean;
    state: string;
    access_until: string | null;
  };
}

function toAuditStatus(value: unknown): SellerLifecycleAuditStatus {
  switch (value) {
    case 'created':
    case 'amazon_connection_required':
    case 'syncing':
    case 'detecting':
    case 'completed':
    case 'failed':
      return value;
    case 'activated':
      return 'completed';
    default:
      return null;
  }
}

function buildAuditDestination(auditId: string): string {
  return `/audit?auditId=${encodeURIComponent(auditId)}`;
}

function buildAmazonPayload(truth: AmazonConnectionTruth): SellerLifecycleResolution['amazon'] {
  return {
    connected: truth.connected,
    needs_reconnect: truth.needsReconnect,
    status: toAmazonLifecycleStatus(truth),
    error_code: truth.errorCode,
    error_message: truth.errorMessage,
  };
}

function getIntentContinuation(
  intent: AuditIntentRecord | null,
  tenantId: string,
): SellerLifecycleResolution['continuation'] | null {
  if (!intent || intent.tenant_id !== tenantId) return null;

  const destination = getSafeAuditIntentReturnPath(intent.return_path);
  if (!destination) return null;

  return {
    kind: 'audit_intent',
    destination,
    audit_id: intent.audit_run_id || null,
    audit_status: null,
    intent_id: intent.id,
  };
}

function getAuditContinuation(audit: any | null): SellerLifecycleResolution['continuation'] | null {
  if (!audit?.id) return null;

  const auditStatus = toAuditStatus(audit.status);
  if (!auditStatus) return null;

  return {
    kind: 'audit',
    destination: buildAuditDestination(String(audit.id)),
    audit_id: String(audit.id),
    audit_status: auditStatus,
    intent_id: null,
  };
}

class SellerLifecycleService {
  async resolve(input: {
    userId: string;
    tenantId: string;
    tenantSlug: string;
    auditIntentId?: string | null;
  }): Promise<SellerLifecycleResolution> {
    const requestedIntentId = String(input.auditIntentId || '').trim();

    const [intent, latestAudit, amazonTruth, entitlementResult] = await Promise.all([
      requestedIntentId
        ? auditIntentService.getOwnedIntentForLifecycle(requestedIntentId, input.userId)
        : Promise.resolve(null),
      auditRunService.getLatestAudit(input.userId, input.tenantId),
      getAuthoritativeAmazonConnectionTruth({
        userId: input.userId,
        tenantId: input.tenantId,
      }),
      workspaceEntitlementService.getTenantEntitlement(input.tenantId),
    ]);

    const tenant = {
      id: input.tenantId,
      slug: input.tenantSlug,
    };
    const amazon = buildAmazonPayload(amazonTruth);
    const entitlement = {
      entitled: entitlementResult.entitlement.entitled,
      state: entitlementResult.entitlement.state,
      access_until: entitlementResult.entitlement.access_until || null,
    };

    const intentContinuation = getIntentContinuation(intent, input.tenantId);
    if (intentContinuation) {
      return { tenant, continuation: intentContinuation, amazon, entitlement };
    }

    const auditContinuation = getAuditContinuation(latestAudit);
    if (auditContinuation) {
      return { tenant, continuation: auditContinuation, amazon, entitlement };
    }

    if (entitlement.entitled) {
      return {
        tenant,
        continuation: {
          kind: 'workspace',
          destination: `/app/${encodeURIComponent(input.tenantSlug)}/dashboard`,
          audit_id: null,
          audit_status: null,
          intent_id: null,
        },
        amazon,
        entitlement,
      };
    }

    return {
      tenant,
      continuation: {
        kind: 'audit_default',
        destination: '/audit',
        audit_id: null,
        audit_status: null,
        intent_id: null,
      },
      amazon,
      entitlement,
    };
  }
}

export const sellerLifecycleService = new SellerLifecycleService();
export default sellerLifecycleService;
