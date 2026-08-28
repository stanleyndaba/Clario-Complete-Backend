import { Request, Response, Router } from 'express';
import { supabaseAdmin } from '../database/supabaseClient';
import requirePlatformAdmin from '../middleware/platformAdminMiddleware';
import logger from '../utils/logger';
import { notifySalesLead } from '../services/salesLeadNotificationService';

const router = Router();
const STATUSES = new Set(['new', 'reviewing', 'qualified', 'not_qualified', 'closed']);
const MAX_PAGE_SIZE = 100;

function textField(value: unknown, label: string, maxLength: number, required = false): string | null {
  if (typeof value !== 'string') {
    if (required) throw new Error(`${label} is required`);
    return null;
  }
  const normalized = value.trim();
  if (!normalized) {
    if (required) throw new Error(`${label} is required`);
    return null;
  }
  if (normalized.length > maxLength) throw new Error(`${label} must be ${maxLength} characters or fewer`);
  return normalized;
}

function emailField(value: unknown): string {
  const email = textField(value, 'Email', 320, true)!.toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Please enter a valid email address');
  return email;
}

function requestMetadata(req: Request): Record<string, unknown> {
  return {
    user_agent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'].slice(0, 500) : null,
    source: 'sales_assessment_form',
  };
}

router.post('/', async (req: Request, res: Response) => {
  try {
    const body = req.body || {};
    const name = textField(body.name, 'Name', 160, true)!;
    const email = emailField(body.email);
    const company = textField(body.company, 'Company', 200, true)!;
    const role = textField(body.role, 'Role', 120, true)!;
    const annualGmv = textField(body.gmv, 'Annual GMV', 80, true)!;
    const accounts = textField(body.accounts, 'Accounts/marketplaces', 500);
    const complexity = textField(body.complexity, 'Catalogue complexity', 2_000);
    const process = textField(body.process, 'Current process', 2_000);
    const objective = textField(body.objective, 'Objective', 2_000);
    const notes = textField(body.notes, 'Additional notes', 5_000);

    const { data, error } = await supabaseAdmin
      .from('sales_leads')
      .insert({
        name,
        email,
        company,
        role,
        annual_gmv: annualGmv,
        accounts_marketplaces: accounts,
        catalogue_complexity: complexity,
        current_process: process,
        objective,
        notes,
        source_page: '/sales',
        status: 'new',
        metadata: requestMetadata(req),
      })
      .select('id, status, created_at')
      .single();

    if (error) {
      logger.error('[SALES_LEADS] Failed to persist lead', { error: error.message, code: error.code });
      return res.status(500).json({ success: false, message: 'We could not save your assessment request. Please try again.' });
    }

    try {
      await notifySalesLead({
        id: data.id,
        name,
        email,
        company,
        role,
        annualGmv,
        accounts,
        complexity,
        process,
        objective,
        notes,
        createdAt: data.created_at
      });
    } catch (notificationError: any) {
      logger.error('[SALES_LEADS] Lead saved but internal notification failed', {
        leadId: data.id,
        error: notificationError?.message || String(notificationError)
      });
    }

    return res.status(201).json({
      success: true,
      lead_id: data.id,
      status: data.status,
      created_at: data.created_at,
      message: 'Your assessment request was saved. Our sales team will review it and follow up.',
    });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error?.message || 'Please review the assessment form.' });
  }
});

router.get('/', requirePlatformAdmin, async (req: Request, res: Response) => {
  try {
    const requestedLimit = Number.parseInt(String(req.query.limit || '50'), 10);
    const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), MAX_PAGE_SIZE) : 50;
    const offsetValue = Number.parseInt(String(req.query.offset || '0'), 10);
    const offset = Number.isFinite(offsetValue) ? Math.max(offsetValue, 0) : 0;
    const requestedStatus = typeof req.query.status === 'string' ? req.query.status.trim() : '';
    if (requestedStatus && !STATUSES.has(requestedStatus)) {
      return res.status(400).json({ success: false, message: 'Unsupported lead status' });
    }

    let query = supabaseAdmin
      .from('sales_leads')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);
    if (requestedStatus) query = query.eq('status', requestedStatus);

    const { data, error, count } = await query;
    if (error) {
      logger.error('[SALES_LEADS] Failed to list leads', { error: error.message, code: error.code });
      return res.status(500).json({ success: false, message: 'Could not load sales leads' });
    }

    return res.json({ success: true, leads: data || [], total: count || 0, limit, offset });
  } catch (error: any) {
    logger.error('[SALES_LEADS] List handler failed', { error: error?.message || String(error) });
    return res.status(500).json({ success: false, message: 'Could not load sales leads' });
  }
});

export default router;
