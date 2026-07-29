import { Request, Response, NextFunction } from 'express';
import {
  BillingSubscriptionRecord,
  SubscriptionEntitlement,
  getTenantRecoverySubscription,
} from './billingSubscriptionRepository';

function nowMs(): number {
  return Date.now();
}

function isFuture(value?: string | null): boolean {
  if (!value) return false;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) && parsed > nowMs();
}

export function deriveSubscriptionEntitlement(subscription: BillingSubscriptionRecord | null): SubscriptionEntitlement {
  if (!subscription) {
    return { entitled: false, state: 'none', access_until: null, subscription_id: null };
  }

  if (subscription.status === 'active') {
    return {
      entitled: true,
      state: 'active',
      access_until: subscription.current_period_end,
      subscription_id: subscription.id,
    };
  }

  if (subscription.status === 'non_renewing') {
    return {
      entitled: isFuture(subscription.current_period_end),
      state: 'non_renewing',
      access_until: subscription.current_period_end,
      subscription_id: subscription.id,
    };
  }

  if (subscription.status === 'past_due') {
    return {
      entitled: isFuture(subscription.grace_expires_at),
      state: 'past_due',
      access_until: subscription.grace_expires_at,
      subscription_id: subscription.id,
    };
  }

  return {
    entitled: false,
    state: subscription.status,
    access_until: subscription.current_period_end || subscription.ended_at,
    subscription_id: subscription.id,
  };
}

class WorkspaceEntitlementService {
  async getTenantEntitlement(tenantId: string): Promise<{
    subscription: BillingSubscriptionRecord | null;
    entitlement: SubscriptionEntitlement;
  }> {
    const subscription = await getTenantRecoverySubscription(tenantId);
    return {
      subscription,
      entitlement: deriveSubscriptionEntitlement(subscription),
    };
  }
}

export const workspaceEntitlementService = new WorkspaceEntitlementService();
export default workspaceEntitlementService;

export async function requireRecoveryWorkspaceEntitlement(req: Request, res: Response, next: NextFunction) {
  try {
    const tenantId = String((req as any).tenant?.tenantId || '').trim();
    const tenantSlug = String((req as any).tenant?.tenantSlug || '').trim();
    const userId = String((req as any).user?.id || (req as any).userId || '').trim();

    if (tenantSlug === 'demo-workspace' || userId === 'demo-user') {
      return next();
    }

    if (!tenantId) {
      return res.status(400).json({ success: false, message: 'Tenant context required' });
    }

    const { entitlement } = await workspaceEntitlementService.getTenantEntitlement(tenantId);
    if (!entitlement.entitled) {
      return res.status(402).json({
        success: false,
        message: 'Recovery Workspace subscription required',
        entitlement,
      });
    }

    (req as any).workspaceEntitlement = entitlement;
    return next();
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error?.message || 'Failed to verify workspace entitlement',
    });
  }
}
