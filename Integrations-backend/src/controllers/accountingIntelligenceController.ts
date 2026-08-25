import { Request, Response } from 'express';
import { accountingIntelligenceService, AccountingProvider } from '../services/accountingIntelligenceService';
import { supabase, supabaseAdmin } from '../database/supabaseClient';

function tenantIdFrom(req: any): string | null {
  return req.tenant?.tenantId || req.tenantId || null;
}

function userIdFrom(req: any): string | null {
  return req.userId || req.user?.id || null;
}

function parseProvider(value: unknown): AccountingProvider | undefined {
  return value === 'quickbooks' || value === 'xero' ? value : undefined;
}

function requireWorkspace(req: Request, res: Response): { tenantId: string; userId: string } | null {
  const tenantId = tenantIdFrom(req);
  const userId = userIdFrom(req);
  if (!tenantId || !userId) {
    res.status(403).json({ ok: false, error: 'Active workspace identity is required.' });
    return null;
  }
  return { tenantId, userId };
}

export async function getAccountingCoverage(req: Request, res: Response): Promise<void> {
  const context = requireWorkspace(req, res);
  if (!context) return;
  try {
    const provider = req.query.provider ? parseProvider(req.query.provider) : undefined;
    if (req.query.provider && !provider) {
      res.status(400).json({ ok: false, error: 'provider must be quickbooks or xero' });
      return;
    }
    const data = await accountingIntelligenceService.getCoverage(context.tenantId, provider);
    res.json({ ok: true, data });
  } catch (error: any) {
    res.status(500).json({ ok: false, error: 'Unable to load accounting coverage.' });
  }
}

export async function getAccountingMappingCandidates(req: Request, res: Response): Promise<void> {
  const context = requireWorkspace(req, res);
  if (!context) return;
  try {
    const provider = req.query.provider ? parseProvider(req.query.provider) : undefined;
    if (req.query.provider && !provider) {
      res.status(400).json({ ok: false, error: 'provider must be quickbooks or xero' });
      return;
    }
    const data = await accountingIntelligenceService.listMappingCandidates(context.tenantId, provider);
    res.json({ ok: true, data });
  } catch (error: any) {
    res.status(500).json({ ok: false, error: 'Unable to load accounting mapping candidates.' });
  }
}

export async function createAccountingSellerMapping(req: Request, res: Response): Promise<void> {
  const context = requireWorkspace(req, res);
  if (!context) return;
  try {
    const evidenceId = String((req.body as any)?.evidenceId || '').trim();
    const sku = String((req.body as any)?.sku || '').trim();
    if (!evidenceId || !sku) {
      res.status(400).json({ ok: false, error: 'evidenceId and sku are required.' });
      return;
    }
    const mapping = await accountingIntelligenceService.createSellerMapping({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      evidenceId,
      sku,
      asin: typeof (req.body as any)?.asin === 'string' ? (req.body as any).asin.trim() || null : null,
      fnsku: typeof (req.body as any)?.fnsku === 'string' ? (req.body as any).fnsku.trim() || null : null,
      effectiveFrom: typeof (req.body as any)?.effectiveFrom === 'string' ? (req.body as any).effectiveFrom : null,
      effectiveTo: typeof (req.body as any)?.effectiveTo === 'string' ? (req.body as any).effectiveTo : null
    });
    res.status(201).json({ ok: true, data: mapping });
  } catch (error: any) {
    const message = String(error?.message || '');
    const status = message.includes('NOT_FOUND') ? 404 : message.includes('QUANTITY_OR_AMOUNT') || message.includes('NON_INVENTORY') ? 422 : 500;
    res.status(status).json({ ok: false, error: message || 'Unable to create accounting mapping.' });
  }
}

export async function getEffectiveAccountingCost(req: Request, res: Response): Promise<void> {
  const context = requireWorkspace(req, res);
  if (!context) return;
  const sku = String(req.query.sku || '').trim();
  if (!sku) {
    res.status(400).json({ ok: false, error: 'sku is required.' });
    return;
  }
  const at = req.query.at ? new Date(String(req.query.at)) : new Date();
  if (Number.isNaN(at.getTime())) {
    res.status(400).json({ ok: false, error: 'at must be a valid ISO date.' });
    return;
  }
  try {
    const data = await accountingIntelligenceService.getEffectiveProductCost(context.tenantId, sku, at);
    res.json({ ok: true, data, status: data ? 'available' : 'unknown_or_review_required' });
  } catch (error: any) {
    res.status(500).json({ ok: false, error: 'Unable to resolve the effective accounting cost.' });
  }
}

export async function getAccountingSyncRuns(req: Request, res: Response): Promise<void> {
  const context = requireWorkspace(req, res);
  if (!context) return;
  const provider = req.query.provider ? parseProvider(req.query.provider) : undefined;
  if (req.query.provider && !provider) {
    res.status(400).json({ ok: false, error: 'provider must be quickbooks or xero' });
    return;
  }
  const db = supabaseAdmin || supabase;
  let query = db
    .from('accounting_sync_runs')
    .select('id, provider, source_id, trigger, status, correlation_id, queue_job_id, attempt_count, records_discovered, records_inserted, records_updated, records_skipped, sync_window_start, sync_window_end, provider_checkpoint_before, provider_checkpoint_after, error_code, started_at, completed_at, created_at')
    .eq('tenant_id', context.tenantId)
    .order('created_at', { ascending: false })
    .limit(50);
  if (provider) query = query.eq('provider', provider);
  const { data, error } = await query;
  if (error) {
    res.status(500).json({ ok: false, error: 'Unable to load accounting sync history.' });
    return;
  }
  res.json({ ok: true, data: data || [] });
}
