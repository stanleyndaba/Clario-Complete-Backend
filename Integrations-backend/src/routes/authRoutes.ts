import { Router } from 'express';
import { authenticateToken, AuthenticatedRequest } from '../middleware/authMiddleware';
import { supabase } from '../database/supabaseClient';

const router = Router();

router.use((req, res, next) => {
  try {
    return (authenticateToken as any)(req as any, res as any, next as any);
  } catch {
    return next();
  }
});

// GET /api/v1/integrations/auth/me
router.get('/me', async (req: AuthenticatedRequest, res) => {
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

    const amazon_connected = !!integrations?.find(i => i.provider === 'amazon' && i.status === 'connected');
    const stripe_connected = !!integrations?.find(i => i.provider === 'stripe' && i.status === 'connected');

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
router.post('/post-login', async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user?.id as string;
    const paymentsUrl = process.env['PAYMENTS_API_URL'];
    const token = req.headers['authorization'] as string | undefined;
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

export default router;


