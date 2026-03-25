import { Router } from 'express';
import { supabase, supabaseAdmin, convertUserIdToUuid } from '../database/supabaseClient';
import { extractRequestToken, verifyAccessToken } from '../utils/authTokenVerifier';

const router = Router();

router.get('/me', async (req, res) => {
  try {
    const token = extractRequestToken(req);

    if (!token) {
      res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
      return;
    }

    const decoded = await verifyAccessToken(token);
    if (!decoded) {
      res.status(401).json({
        success: false,
        message: 'Invalid or expired token'
      });
      return;
    }

    const user_id = decoded.id;

    if (!user_id) {
      res.status(401).json({
        success: false,
        message: 'Invalid token payload'
      });
      return;
    }

    const tenantSlug = ((req.query.tenantSlug as string) || (req.query.tenant_slug as string) || '').trim();
    const headerTenantId = (req.headers['x-tenant-id'] as string || '').trim();
    const adminClient = supabaseAdmin || supabase;
    const safeUserId = convertUserIdToUuid(user_id);

    let tenant: { id: string; slug?: string; name?: string } | null = null;
    let membership: { role?: string } | null = null;

    if (tenantSlug) {
      const { data: tenantData, error: tenantError } = await adminClient
        .from('tenants')
        .select('id, slug, name')
        .eq('slug', tenantSlug)
        .is('deleted_at', null)
        .maybeSingle();

      if (tenantError) {
        res.status(500).json({
          success: false,
          message: 'Failed to resolve tenant context'
        });
        return;
      }

      if (!tenantData) {
        res.status(404).json({
          success: false,
          message: 'Tenant not found'
        });
        return;
      }

      const { data: membershipData, error: membershipError } = await adminClient
        .from('tenant_memberships')
        .select('role')
        .eq('tenant_id', tenantData.id)
        .eq('user_id', safeUserId)
        .eq('is_active', true)
        .is('deleted_at', null)
        .maybeSingle();

      if (membershipError) {
        res.status(500).json({
          success: false,
          message: 'Failed to verify tenant membership'
        });
        return;
      }

      if (!membershipData) {
        res.status(403).json({
          success: false,
          message: 'You do not have access to this tenant'
        });
        return;
      }

      tenant = tenantData;
      membership = membershipData;
    } else if (headerTenantId) {
      const { data: membershipData } = await adminClient
        .from('tenant_memberships')
        .select('role')
        .eq('tenant_id', headerTenantId)
        .eq('user_id', safeUserId)
        .eq('is_active', true)
        .is('deleted_at', null)
        .maybeSingle();

      if (membershipData) {
        const { data: tenantData } = await adminClient
          .from('tenants')
          .select('id, slug, name')
          .eq('id', headerTenantId)
          .is('deleted_at', null)
          .maybeSingle();

        if (tenantData) {
          tenant = tenantData;
          membership = membershipData;
        }
      }
    }

    let userQuery = adminClient
      .from('users')
      .select('id, email, company_name, amazon_seller_id, seller_id, paypal_payment_token, paypal_email, created_at, last_login_at, tenant_id')
      .eq('id', safeUserId);

    if (tenant?.id) {
      userQuery = userQuery.eq('tenant_id', tenant.id);
    }

    const { data: userRecord, error: userError } = await userQuery.maybeSingle();

    if (userError && userError.code !== 'PGRST116') {
      res.status(500).json({
        success: false,
        message: 'Failed to load user profile'
      });
      return;
    }

    if (tenant?.id && !userRecord) {
      res.status(404).json({
        success: false,
        message: 'No tenant-bound user profile found'
      });
      return;
    }

    let amazon_connected = false;
    let amazonAccount: { seller_id?: string; display_name?: string; email?: string } | null = null;

    try {
      let tokenQuery = adminClient
        .from('tokens')
        .select('expires_at, tenant_id')
        .eq('user_id', safeUserId)
        .eq('provider', 'amazon')
        .order('updated_at', { ascending: false })
        .limit(1);

      if (tenant?.id) {
        tokenQuery = tokenQuery.eq('tenant_id', tenant.id);
      }

      const { data: amazonToken } = await tokenQuery.maybeSingle();
      if (amazonToken && (!amazonToken.expires_at || new Date(amazonToken.expires_at) > new Date())) {
        amazon_connected = true;
      }
    } catch (_) {
      amazon_connected = false;
    }

    if (userRecord) {
      amazonAccount = {
        seller_id: userRecord.amazon_seller_id || userRecord.seller_id || undefined,
        display_name: userRecord.company_name || undefined,
        email: userRecord.email || undefined
      };
    }

    const resolvedEmail = userRecord?.email || decoded.email || null;
    const resolvedName = userRecord?.company_name || null;

    res.json({
      id: userRecord?.id || safeUserId,
      email: resolvedEmail,
      name: resolvedName,
      company_name: userRecord?.company_name || null,
      amazon_seller_id: userRecord?.amazon_seller_id || userRecord?.seller_id || null,
      seller_id: userRecord?.seller_id || null,
      amazon_connected,
      amazon_account: amazonAccount,
      stripe_connected: false,
      paypal_connected: !!userRecord?.paypal_payment_token,
      paypal_email: userRecord?.paypal_email || null,
      paypal_payment_token: userRecord?.paypal_payment_token || null,
      billing_provider: 'paypal',
      created_at: userRecord?.created_at || null,
      last_login: userRecord?.last_login_at || null,
      tenant_id: tenant?.id || userRecord?.tenant_id || null,
      tenant_slug: tenant?.slug || null,
      tenant_name: tenant?.name || null,
      role: membership?.role || null
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error?.message || 'Internal server error'
    });
  }
});

router.get('/user', async (req, res) => {
  try {
    const token = extractRequestToken(req);

    if (!token) {
      res.status(401).json({
        success: false,
        message: 'Access token required'
      });
      return;
    }

    const decoded = await verifyAccessToken(token);
    if (!decoded) {
      res.status(401).json({
        success: false,
        message: 'Invalid or expired token'
      });
      return;
    }

    res.json({
      success: true,
      user: {
        id: decoded.id || 'user-123',
        email: decoded.email || 'user@example.com',
        name: 'Test User'
      }
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error?.message || 'Internal server error'
    });
  }
});

router.get('/profile', async (_req, res) => {
  try {
    res.json({
      success: true,
      profile: {
        id: 'user-123',
        email: 'user@example.com',
        name: 'Test User',
        company: 'Test Company'
      }
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error?.message || 'Internal server error'
    });
  }
});

router.post('/profile', async (req, res) => {
  try {
    const { name, company } = req.body;

    res.json({
      success: true,
      message: 'Profile updated successfully',
      profile: {
        id: 'user-123',
        email: 'user@example.com',
        name: name || 'Test User',
        company: company || 'Test Company'
      }
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error?.message || 'Internal server error'
    });
  }
});

router.post('/logout', async (_req, res) => {
  try {
    res.clearCookie('session_token', { path: '/', sameSite: 'none', secure: true, httpOnly: true });
    res.clearCookie('session', { path: '/', sameSite: 'none', secure: true });
    res.json({ ok: true, message: 'Logged out successfully' });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error?.message || 'Internal server error' });
  }
});

router.get('/billing', async (_req, res) => {
  try {
    res.json({
      success: true,
      billing: {
        plan: 'pro',
        status: 'active',
        nextBillingDate: '2024-12-01'
      }
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error?.message || 'Internal server error'
    });
  }
});

export default router;
