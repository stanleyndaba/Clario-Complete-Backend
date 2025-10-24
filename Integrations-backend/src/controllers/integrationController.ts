import { Request, Response } from 'express';
import config from '../config/env';
import { getRedisClient } from '../utils/redisClient';
import { createStateValidator } from '../utils/stateValidator';
import tokenManager from '../utils/tokenManager';
import logger from '../utils/logger';
import { supabase } from '../database/supabaseClient';

export const getIntegrationStatus = async (req: Request, res: Response) => {
  try {
    const { provider } = req.params;
    
    // Mock integration status
    res.json({
      success: true,
      provider: provider,
      connected: true,
      status: 'active',
      lastSync: new Date().toISOString(),
      data: {
        email: provider === 'gmail' ? 'user@example.com' : undefined,
        account: provider === 'amazon' ? 'Seller123' : undefined
      }
    });
  } catch (error) {
    console.error('Integration status error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get integration status'
    });
  }
};

export const reconnectIntegration = async (req: Request, res: Response) => {
  try {
    const { provider } = req.params;
    
    // Mock reconnect URL - using template literal with backticks
    res.json({
      success: true,
      provider: provider,
      reconnectUrl: 'http://localhost:3001/api/v1/integrations/' + provider + '/auth/start',
      message: 'Reconnect initiated'
    });
  } catch (error) {
    console.error('Reconnect error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to reconnect integration'
    });
  }
};

export const disconnectIntegration = async (req: Request, res: Response) => {
  try {
    const { provider } = req.params;
    
    // Mock disconnect
    res.json({
      success: true,
      provider: provider,
      message: 'Integration disconnected successfully'
    });
  } catch (error) {
    console.error('Disconnect error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to disconnect integration'
    });
  }
};

export const getAllIntegrations = async (_req: Request, res: Response) => {
  try {
    // Mock all integrations status
    res.json({
      success: true,
      integrations: [
        {
          provider: 'amazon',
          connected: true,
          status: 'active',
          lastSync: new Date().toISOString()
        },
        {
          provider: 'gmail', 
          connected: true,
          status: 'active',
          lastSync: new Date().toISOString()
        },
        {
          provider: 'stripe',
          connected: false,
          status: 'disconnected',
          lastSync: null
        }
      ]
    });
  } catch (error) {
    console.error('All integrations error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get integrations'
    });
  }
};

// --- Step 1: Amazon Auth Flow ---
export const connectAmazon = async (req: Request, res: Response) => {
  try {
    const redis = await getRedisClient();
    const validator = createStateValidator(redis);
    const userId = (req as any).user?.id || 'demo-user';
    const state = await validator.generateState(userId);

    const base = config.AMAZON_AUTH_CONSENT_URL as string;
    const url = new URL(base);
    url.searchParams.set('application_id', config.AMAZON_SPAPI_CLIENT_ID || '');
    url.searchParams.set('state', state);
    url.searchParams.set('version', 'beta');
    url.searchParams.set('redirect_uri', config.AMAZON_SPAPI_REDIRECT_URI || '');

    res.status(200).json({ auth_url: url.toString(), state });
  } catch (error: any) {
    logger.error('connectAmazon failed', { error: error.message });
    res.status(500).json({ error: 'Failed to initiate Amazon OAuth' });
  }
};

export const amazonCallback = async (req: Request, res: Response) => {
  try {
    const { code, state } = req.query as any;
    if (!code || !state) {
      res.status(400).json({ success: false, message: 'Missing OAuth parameters' });
      return;
    }

    const redis = await getRedisClient();
    const validator = createStateValidator(redis);
    const validation = await validator.validateOAuthState(state);
    if (!validation.valid || !validation.userId) {
      res.status(400).json({ success: false, message: 'Invalid or expired OAuth state' });
      return;
    }

    // Exchange code for tokens (sandbox-ready; real exchange stubbed)
    // In sandbox, we can accept provided REFRESH_TOKEN to bootstrap
    const accessToken = 'sandbox-access-token';
    const refreshToken = config.AMAZON_SPAPI_REFRESH_TOKEN || 'sandbox-refresh-token';
    const expiresAt = new Date(Date.now() + 3600 * 1000);
    await tokenManager.saveToken(validation.userId, 'amazon', {
      accessToken,
      refreshToken,
      expiresAt
    });

    // Spin up tenant (stubbed)
    if ((supabase as any).from) {
      await supabase.from('tenants').upsert({
        user_id: validation.userId,
        provider: 'amazon',
        created_at: new Date().toISOString()
      }, { onConflict: 'user_id,provider' });
    }

    // Set session cookie (demo)
    const cookieDomain = config.COOKIE_DOMAIN || undefined;
    res.cookie('session', `user=${validation.userId}`, {
      httpOnly: true,
      secure: true,
      sameSite: 'none' as any,
      domain: cookieDomain,
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

    // Queue initial sync (stub)
    // TODO: integrate with orchestrator

    const scopes = ['orders.read', 'inventory.read', 'transactions.read'];
    res.redirect(`/auth/success?provider=amazon&status=ok&scopes=${scopes.join(',')}`);
  } catch (error: any) {
    logger.error('amazonCallback failed', { error: error.message });
    res.status(500).json({ success: false, message: 'OAuth callback failed' });
  }
};

export const amazonSandboxCallback = async (req: Request, res: Response) => {
  try {
    const { state } = req.body || {};
    if (!state) {
      res.status(400).json({ success: false, message: 'Missing state' });
      return;
    }

    const redis = await getRedisClient();
    const validator = createStateValidator(redis);
    const validation = await validator.validateOAuthState(state);
    if (!validation.valid || !validation.userId) {
      res.status(400).json({ success: false, message: 'Invalid or expired OAuth state' });
      return;
    }

    const accessToken = 'sandbox-access-token';
    const refreshToken = config.AMAZON_SPAPI_REFRESH_TOKEN || 'sandbox-refresh-token';
    const expiresAt = new Date(Date.now() + 3600 * 1000);
    await tokenManager.saveToken(validation.userId, 'amazon', {
      accessToken,
      refreshToken,
      expiresAt
    });

    // Create tenant stub
    if ((supabase as any).from) {
      await supabase.from('tenants').upsert({
        user_id: validation.userId,
        provider: 'amazon',
        created_at: new Date().toISOString()
      }, { onConflict: 'user_id,provider' });
    }

    // Set session cookie
    const cookieDomain = config.COOKIE_DOMAIN || undefined;
    res.cookie('session', `user=${validation.userId}`, {
      httpOnly: true,
      secure: true,
      sameSite: 'none' as any,
      domain: cookieDomain,
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

    res.status(200).json({ ok: true });
  } catch (error: any) {
    logger.error('amazonSandboxCallback failed', { error: error.message });
    res.status(500).json({ success: false, message: 'Sandbox callback failed' });
  }
};

export const getRecoveries = async (_req: Request, res: Response) => {
  res.json({ totalAmount: 1825.4, currency: 'USD', claimCount: 12 });
};
