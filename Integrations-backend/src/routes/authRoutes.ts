import { Router } from 'express';
import { authenticateToken, AuthenticatedRequest, generateToken } from '../middleware/authMiddleware';
import { supabase } from '../database/supabaseClient';
import jwt from 'jsonwebtoken';
import config from '../config/env';

const router = Router();

router.use((req, res, next) => {
  try {
    return (authenticateToken as any)(req as any, res as any, next as any);
  } catch {
    return next();
  }
});

// Helper to parse cookie header without external deps
function getCookie(req: any, name: string): string | undefined {
  try {
    const cookieHeader: string | undefined = req.headers?.cookie;
    if (!cookieHeader) return undefined;
    const parts = cookieHeader.split(';');
    for (const part of parts) {
      const [k, ...rest] = part.trim().split('=');
      if (k === name) return decodeURIComponent(rest.join('='));
    }
  } catch {}
  return undefined;
}

// GET /api/v1/integrations/auth/me
router.get('/me', async (req: AuthenticatedRequest, res: any) => {
  try {
    const userId = req.user?.id as string;
    if (!userId) {
      return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } });
    }

    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id, email, name, created_at, last_login, roles, stripe_customer_id, stripe_subscription_status, last_sync_completed_at')
      .eq('id', userId)
      .single();

    if (userError) {
      return res.status(500).json({ success: false, error: { code: 'USER_FETCH_ERROR', message: userError.message } });
    }

    const { data: integrations } = await supabase
      .from('integrations')
      .select('provider, status')
      .eq('user_id', userId);

    const amazon_connected = !!integrations?.find((i: any) => i.provider === 'amazon' && i.status === 'connected');
    const stripe_connected = !!integrations?.find((i: any) => i.provider === 'stripe' && i.status === 'connected');

    return res.json({
      success: true,
      user: {
        id: user?.id,
        email: user?.email,
        name: user?.name,
        roles: user?.roles || [],
        amazon_connected,
        stripe_connected,
        stripe_customer_id: user?.stripe_customer_id || null,
        stripe_subscription_status: user?.stripe_subscription_status || null,
        created_at: user?.created_at,
        last_login: user?.last_login,
        last_sync_completed_at: user?.last_sync_completed_at || null
      }
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: error?.message || 'Internal error' } });
  }
});

// POST /api/v1/integrations/auth/post-login - initialize Stripe customer/subscription
router.post('/post-login', async (req: AuthenticatedRequest, res: any) => {
  try {
    const userId = req.user?.id as string;
    const paymentsUrl = process.env['PAYMENTS_API_URL'];
    const token = (req as any).headers['authorization'] as string | undefined;
    if (!paymentsUrl) {
      return res.status(500).json({ success: false, error: { code: 'MISSING_CONFIG', message: 'PAYMENTS_API_URL not configured' } });
    }

    // Create customer + setup intent if needed
    const resp = await fetch(`${paymentsUrl}/api/v1/stripe/create-customer-setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': token } : {}) },
      body: JSON.stringify({})
    });
    const data = await resp.json();

    // Persist stripe_customer_id to users table if returned
    if (data?.customerId) {
      await supabase
        .from('users')
        .update({ stripe_customer_id: data.customerId })
        .eq('id', userId);
    }

    // Auto-sync trigger on first login (idempotent)
    try {
      const { data: userRow } = await supabase
        .from('users')
        .select('has_synced_initial')
        .eq('id', userId)
        .single();
      const alreadySynced = Boolean(userRow?.has_synced_initial);
      if (!alreadySynced) {
        const baseUrl = process.env['SELF_BASE_URL'] || '';
        const syncUrl = baseUrl ? `${baseUrl}/api/v1/integrations/sync/start` : '/api/v1/integrations/sync/start';
        await fetch(syncUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': token } : {}) },
          body: JSON.stringify({ syncType: 'inventory', enableDetection: true })
        }).catch(() => undefined);
        await supabase
          .from('users')
          .update({ has_synced_initial: true })
          .eq('id', userId);
      }
    } catch {}

    // Suggest connecting Evidence sources if none exist yet
    let evidenceSuggestion: { hasSources: boolean; connectSuggested: boolean } = { hasSources: false, connectSuggested: false };
    try {
      const { data: sources } = await supabase
        .from('evidence_sources')
        .select('id')
        .eq('seller_id', userId)
        .limit(1);
      const hasSources = Array.isArray(sources) && sources.length > 0;
      evidenceSuggestion = { hasSources, connectSuggested: !hasSources };
    } catch {}

    return res.json({ success: true, stripe: data, nextActions: { connectEvidence: evidenceSuggestion.connectSuggested } });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: error?.message || 'Internal error' } });
  }
});

// POST /api/v1/integrations/auth/exchange-session
// Accepts a valid session cookie (e.g., 'session_token' issued by the orchestrator)
// Returns a JWT compatible with this service: { id, email }
router.post('/exchange-session', async (req: any, res) => {
  try {
    const cookieName = (process.env['SESSION_COOKIE_NAME'] || 'session_token');
    const token = getCookie(req, cookieName);
    if (!token) {
      return res.status(401).json({ success: false, error: { code: 'NO_SESSION', message: 'Session cookie not found' } });
    }

    // Decode orchestrator session to extract user_id
    let payload: any;
    try {
      const orchestratorSecret = process.env['ORCHESTRATOR_JWT_SECRET'] || config.JWT_SECRET;
      payload = jwt.verify(token, orchestratorSecret);
    } catch (e: any) {
      return res.status(401).json({ success: false, error: { code: 'INVALID_SESSION', message: 'Invalid or expired session' } });
    }

    const userId: string | undefined = payload?.user_id || payload?.id;
    if (!userId) {
      return res.status(400).json({ success: false, error: { code: 'MISSING_USER', message: 'No user_id in session' } });
    }

    const { data: user, error } = await supabase
      .from('users')
      .select('id, email')
      .eq('id', userId)
      .single();
    if (error || !user) {
      return res.status(404).json({ success: false, error: { code: 'USER_NOT_FOUND', message: 'User not found' } });
    }

    const accessToken = generateToken(user.id, user.email);
    return res.json({ success: true, token: accessToken, user: { id: user.id, email: user.email } });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: error?.message || 'Internal error' } });
  }
});

// GET /api/v1/integrations/auth/debug
router.get('/debug', async (req: any, res) => {
  try {
    const cookieName = (process.env['SESSION_COOKIE_NAME'] || 'session_token');
    const session = getCookie(req, cookieName);
    return res.json({
      success: true,
      envVarsSet: {
        ORCHESTRATOR_JWT_SECRET: Boolean(process.env['ORCHESTRATOR_JWT_SECRET']),
        JWT_SECRET: Boolean(process.env['JWT_SECRET']),
        SUPABASE_URL: Boolean(process.env['SUPABASE_URL']),
        SUPABASE_ANON_KEY: Boolean(process.env['SUPABASE_ANON_KEY'])
      },
      cookieReceived: {
        name: cookieName,
        exists: Boolean(session),
        length: session ? session.length : 0
      }
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: error?.message || 'Internal error' } });
  }
});

export default router;


