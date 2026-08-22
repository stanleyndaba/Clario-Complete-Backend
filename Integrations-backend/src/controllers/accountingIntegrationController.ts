import { Request, Response } from 'express';
import logger from '../utils/logger';
import tokenManager from '../utils/tokenManager';
import { supabase, supabaseAdmin, convertUserIdToUuid } from '../database/supabaseClient';
import { addAccountingSyncJob } from '../queues/ingestionQueue';

type AccountingProvider = 'quickbooks' | 'xero';

function isAccountingProvider(provider: string): provider is AccountingProvider {
  return provider === 'quickbooks' || provider === 'xero';
}

async function resolveAuthorizedAccountingContext(req: Request, res: Response, provider: string): Promise<{
  userId: string;
  dbUserId: string;
  tenantId: string;
  tenantSlug: string;
  provider: AccountingProvider;
} | null> {
  const userId = (req as any).userId || (req as any).user?.id || (req as any).user?.user_id;
  const tenantSlug = String(req.query.tenantSlug || req.query.tenant_slug || req.body?.tenantSlug || req.body?.tenant_slug || '').trim();

  if (!userId) {
    res.status(401).json({ ok: false, error: 'Authentication required' });
    return null;
  }
  if (!isAccountingProvider(provider)) {
    res.status(400).json({ ok: false, error: 'Unsupported accounting provider' });
    return null;
  }
  if (!tenantSlug) {
    res.status(400).json({ ok: false, error: 'tenantSlug is required' });
    return null;
  }

  const adminClient = supabaseAdmin || supabase;
  const dbUserId = convertUserIdToUuid(userId);
  const { data: tenant, error: tenantError } = await adminClient
    .from('tenants')
    .select('id, slug')
    .eq('slug', tenantSlug)
    .is('deleted_at', null)
    .maybeSingle();

  if (tenantError || !tenant) {
    res.status(tenantError ? 500 : 404).json({ ok: false, error: tenantError ? 'Failed to resolve tenant context' : 'Tenant not found' });
    return null;
  }

  const { data: membership, error: membershipError } = await adminClient
    .from('tenant_memberships')
    .select('id')
    .eq('tenant_id', tenant.id)
    .eq('user_id', dbUserId)
    .eq('is_active', true)
    .is('deleted_at', null)
    .maybeSingle();

  if (membershipError || !membership) {
    res.status(membershipError ? 500 : 403).json({ ok: false, error: membershipError ? 'Failed to verify tenant membership' : 'You do not have access to this tenant' });
    return null;
  }

  return { userId, dbUserId, tenantId: tenant.id, tenantSlug: tenant.slug, provider };
}

export async function requestAccountingSync(req: Request, res: Response): Promise<void> {
  const context = await resolveAuthorizedAccountingContext(req, res, req.params.provider);
  if (!context) return;

  const adminClient = supabaseAdmin || supabase;
  const { data: source, error: sourceError } = await adminClient
    .from('evidence_sources')
    .select('id, status')
    .eq('tenant_id', context.tenantId)
    .eq('user_id', context.dbUserId)
    .eq('provider', context.provider)
    .maybeSingle();

  if (sourceError || !source || source.status !== 'connected') {
    res.status(sourceError ? 500 : 409).json({
      ok: false,
      error: sourceError ? 'Failed to resolve accounting connection' : 'Connect this accounting provider before requesting a verification read.'
    });
    return;
  }

  const jobId = await addAccountingSyncJob(context.userId, context.tenantId, context.provider);
  if (!jobId) {
    const message = 'Margin could not schedule the financial evidence verification. Try again shortly or reconnect the provider.';
    await adminClient
      .from('evidence_sources')
      .update({ accounting_read_status: 'failed', accounting_last_error: message, updated_at: new Date().toISOString() })
      .eq('id', source.id)
      .eq('tenant_id', context.tenantId);
    res.status(503).json({ ok: false, error: message });
    return;
  }

  res.status(202).json({
    ok: true,
    provider: context.provider,
    jobId,
    status: 'pending',
    message: 'Financial evidence verification has been scheduled.'
  });
}

export async function disconnectAccountingIntegration(req: Request, res: Response): Promise<void> {
  const context = await resolveAuthorizedAccountingContext(req, res, req.params.provider);
  if (!context) return;

  const adminClient = supabaseAdmin || supabase;
  const { data: source, error: sourceError } = await adminClient
    .from('evidence_sources')
    .select('id')
    .eq('tenant_id', context.tenantId)
    .eq('user_id', context.dbUserId)
    .eq('provider', context.provider)
    .maybeSingle();

  if (sourceError) {
    res.status(500).json({ ok: false, error: 'Failed to resolve the accounting connection' });
    return;
  }
  if (!source) {
    res.status(404).json({ ok: false, error: 'Accounting connection not found for this workspace' });
    return;
  }

  try {
    await tokenManager.revokeToken(context.userId, context.provider, undefined, context.tenantId);
  } catch (error: any) {
    logger.error('Accounting token revocation failed', {
      provider: context.provider,
      tenantId: context.tenantId,
      userId: context.userId,
      error: error?.message || String(error)
    });
    res.status(500).json({ ok: false, error: 'Margin could not revoke the encrypted accounting credential.' });
    return;
  }

  const { error: updateError } = await adminClient
    .from('evidence_sources')
    .update({
      status: 'disconnected',
      accounting_read_status: null,
      accounting_last_error: null,
      updated_at: new Date().toISOString()
    })
    .eq('id', source.id)
    .eq('tenant_id', context.tenantId)
    .eq('user_id', context.dbUserId)
    .eq('provider', context.provider);

  if (updateError) {
    res.status(500).json({ ok: false, error: 'Credential access was revoked but Margin could not update the connection state.' });
    return;
  }

  res.json({
    ok: true,
    provider: context.provider,
    message: `${context.provider === 'quickbooks' ? 'QuickBooks' : 'Xero'} was disconnected from this workspace. Historical financial evidence remains retained as inactive source history.`
  });
}
