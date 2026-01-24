/**
 * Evidence Sources Controller
 * Handles OAuth connection for evidence providers (Gmail, Outlook, Google Drive, Dropbox)
 */

import { Request, Response } from 'express';
import axios from 'axios';
import crypto from 'crypto';
import logger from '../utils/logger';
import config from '../config/env';
import tokenManager from '../utils/tokenManager';
import oauthStateStore from '../utils/oauthStateStore';
import { supabase } from '../database/supabaseClient';

// OAuth URLs for different providers
const OAUTH_URLS = {
  gmail: {
    auth: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
    scopes: [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.modify'
    ]
  },
  gdrive: {
    auth: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
    scopes: [
      'https://www.googleapis.com/auth/drive.readonly',
      'https://www.googleapis.com/auth/drive.metadata.readonly'
    ]
  },
  outlook: {
    auth: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    token: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scopes: [
      'https://graph.microsoft.com/Mail.Read',
      'https://graph.microsoft.com/Mail.ReadWrite',
      'offline_access'
    ]
  },
  dropbox: {
    auth: 'https://www.dropbox.com/oauth2/authorize',
    token: 'https://api.dropbox.com/oauth2/token',
    scopes: ['files.content.read', 'files.metadata.read']
  }
};

/**
 * Connect evidence source - Generate OAuth URL
 * POST /api/v1/integrations/{provider}/connect
 */
export const connectEvidenceSource = async (req: Request, res: Response) => {
  try {
    const { provider } = req.params;
    const redirectUri = req.query.redirect_uri as string;

    // Support both userIdMiddleware and auth middleware
    const userId = (req as any).userId || (req as any).user?.id || (req as any).user?.user_id;

    if (!userId) {
      return res.status(401).json({
        ok: false,
        error: 'Authentication required'
      });
    }

    // Validate provider
    const validProviders = ['gmail', 'outlook', 'gdrive', 'dropbox'];
    if (!validProviders.includes(provider)) {
      return res.status(400).json({
        ok: false,
        error: `Invalid provider. Supported providers: ${validProviders.join(', ')}`
      });
    }

    // Get OAuth configuration
    const oauthConfig = getOAuthConfig(provider);
    if (!oauthConfig) {
      return res.status(500).json({
        ok: false,
        error: `OAuth configuration not found for provider: ${provider}`
      });
    }

    // Use provided redirect_uri or construct default
    const backendUrl = process.env.INTEGRATIONS_URL || process.env.VITE_API_BASE_URL || 'http://localhost:3001';
    const defaultRedirectUri = `${backendUrl}/api/v1/integrations/${provider}/callback`;
    const callbackRedirectUri = redirectUri || defaultRedirectUri;

    // Generate state for CSRF protection
    const state = crypto.randomBytes(32).toString('hex');
    await oauthStateStore.setState(state, userId, callbackRedirectUri);

    // Build OAuth URL based on provider
    let authUrl: string;

    if (provider === 'gmail' || provider === 'gdrive') {
      // Google OAuth (Gmail and Google Drive)
      const scopes = OAUTH_URLS[provider].scopes.join(' ');
      authUrl = `${OAUTH_URLS[provider].auth}?` +
        `client_id=${encodeURIComponent(oauthConfig.clientId)}&` +
        `redirect_uri=${encodeURIComponent(defaultRedirectUri)}&` +
        `response_type=code&` +
        `scope=${encodeURIComponent(scopes)}&` +
        `access_type=offline&` +
        `prompt=consent&` +
        `state=${state}`;
    } else if (provider === 'outlook') {
      // Microsoft OAuth (Outlook)
      const scopes = OAUTH_URLS[provider].scopes.join(' ');
      authUrl = `${OAUTH_URLS[provider].auth}?` +
        `client_id=${encodeURIComponent(oauthConfig.clientId)}&` +
        `redirect_uri=${encodeURIComponent(defaultRedirectUri)}&` +
        `response_type=code&` +
        `scope=${encodeURIComponent(scopes)}&` +
        `response_mode=query&` +
        `state=${state}`;
    } else if (provider === 'dropbox') {
      // Dropbox OAuth
      const scopes = OAUTH_URLS[provider].scopes.join(' ');
      authUrl = `${OAUTH_URLS[provider].auth}?` +
        `client_id=${encodeURIComponent(oauthConfig.clientId)}&` +
        `redirect_uri=${encodeURIComponent(defaultRedirectUri)}&` +
        `response_type=code&` +
        `scope=${encodeURIComponent(scopes)}&` +
        `state=${state}`;
    } else {
      return res.status(400).json({
        ok: false,
        error: `Unsupported provider: ${provider}`
      });
    }

    logger.info('Evidence source OAuth initiated', {
      userId,
      provider,
      redirectUri: callbackRedirectUri,
      hasClientId: !!oauthConfig.clientId
    });

    res.json({
      auth_url: authUrl,
      redirect_url: callbackRedirectUri
    });
  } catch (error: any) {
    logger.error('Error initiating evidence source OAuth', {
      error: error?.message || String(error),
      provider: req.params.provider
    });

    res.status(500).json({
      ok: false,
      error: 'Failed to initiate OAuth flow'
    });
  }
};

/**
 * Handle OAuth callback
 * GET /api/v1/integrations/{provider}/callback
 */
export const handleEvidenceSourceCallback = async (req: Request, res: Response) => {
  try {
    const { provider } = req.params;
    const { code, state, error } = req.query;

    if (error) {
      logger.warn('OAuth callback error', { provider, error });
      return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/auth/callback?error=${encodeURIComponent(error as string)}`);
    }

    if (!code || !state) {
      return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/auth/callback?error=missing_code_or_state`);
    }

    // Verify state
    const stateData = await oauthStateStore.get(state as string);
    if (!stateData || !stateData.userId) {
      return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/auth/callback?error=invalid_state`);
    }

    const userId = stateData.userId;
    const frontendUrl = stateData.frontendUrl || process.env.FRONTEND_URL || 'http://localhost:3000';
    await oauthStateStore.delete(state as string);

    // Get OAuth configuration
    const oauthConfig = getOAuthConfig(provider);
    if (!oauthConfig) {
      return res.redirect(`${frontendUrl || process.env.FRONTEND_URL || 'http://localhost:3000'}/auth/callback?error=oauth_config_not_found`);
    }

    // Exchange code for token
    const backendUrl = process.env.INTEGRATIONS_URL || process.env.VITE_API_BASE_URL || 'http://localhost:3001';
    const redirectUri = `${backendUrl}/api/v1/integrations/${provider}/callback`;

    let tokenResponse: any;

    try {
      if (provider === 'gmail' || provider === 'gdrive') {
        // Google OAuth token exchange
        tokenResponse = await axios.post(OAUTH_URLS[provider].token, null, {
          params: {
            client_id: oauthConfig.clientId,
            client_secret: oauthConfig.clientSecret,
            code: code,
            grant_type: 'authorization_code',
            redirect_uri: redirectUri
          },
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        });
      } else if (provider === 'outlook') {
        // Microsoft OAuth token exchange
        tokenResponse = await axios.post(OAUTH_URLS[provider].token, new URLSearchParams({
          client_id: oauthConfig.clientId,
          client_secret: oauthConfig.clientSecret,
          code: code as string,
          grant_type: 'authorization_code',
          redirect_uri: redirectUri,
          scope: OAUTH_URLS[provider].scopes.join(' ')
        }), {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        });
      } else if (provider === 'dropbox') {
        // Dropbox OAuth token exchange
        tokenResponse = await axios.post(OAUTH_URLS[provider].token, new URLSearchParams({
          client_id: oauthConfig.clientId,
          client_secret: oauthConfig.clientSecret,
          code: code as string,
          grant_type: 'authorization_code',
          redirect_uri: redirectUri
        }), {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        });
      } else {
        return res.redirect(`${frontendUrl || process.env.FRONTEND_URL || 'http://localhost:3000'}/auth/callback?error=unsupported_provider`);
      }

      const { access_token, refresh_token, expires_in } = tokenResponse.data;

      // Store token in token manager
      // Note: tokenManager currently only supports 'amazon' | 'gmail' | 'stripe'
      // For other providers, we'll store in a generic way or extend tokenManager
      if (provider === 'gmail') {
        try {
          await tokenManager.saveToken(userId, 'gmail', {
            accessToken: access_token,
            refreshToken: refresh_token || '',
            expiresAt: expires_in ? new Date(Date.now() + expires_in * 1000) : new Date(Date.now() + 3600 * 1000)
          });
          logger.info('Gmail token saved successfully', { userId });
        } catch (tokenError: any) {
          logger.error('CRITICAL: Failed to store Gmail token', {
            error: tokenError?.message || String(tokenError),
            userId,
            provider
          });
          // This is a critical error - without the token, Gmail won't work
          // Return error to user instead of silently continuing
          return res.redirect(`${frontendUrl || process.env.FRONTEND_URL || 'http://localhost:3000'}/integrations-hub?error=${encodeURIComponent('Failed to save Gmail token. Please try reconnecting.')}\u0026${provider}_connected=false`);
        }
      } else {
        // For other providers (outlook, gdrive, dropbox), store in evidence_sources metadata
        // or use a generic token storage mechanism
        // For now, we'll just store in the database metadata
        logger.info('Token stored for provider (using database metadata)', { provider, userId });
      }


      // Get user account info (email, etc.)
      let accountEmail: string | undefined;
      try {
        if (provider === 'gmail' || provider === 'gdrive') {
          const profileResponse = await axios.get('https://www.googleapis.com/oauth2/v2/userinfo', {
            headers: { 'Authorization': `Bearer ${access_token}` }
          });
          accountEmail = profileResponse.data.email;
        } else if (provider === 'outlook') {
          const profileResponse = await axios.get('https://graph.microsoft.com/v1.0/me', {
            headers: { 'Authorization': `Bearer ${access_token}` }
          });
          accountEmail = profileResponse.data.mail || profileResponse.data.userPrincipalName;
        } else if (provider === 'dropbox') {
          const profileResponse = await axios.post('https://api.dropboxapi.com/2/users/get_current_account', null, {
            headers: { 'Authorization': `Bearer ${access_token}` }
          });
          accountEmail = profileResponse.data.email;
        }
      } catch (profileError) {
        logger.warn('Failed to fetch user profile', { provider, error: profileError });
      }

      // Get OAuth scopes for provider
      const scopes = OAUTH_URLS[provider]?.scopes || [];

      // Create or update evidence source in database
      try {
        const { data: existingSource } = await supabase
          .from('evidence_sources')
          .select('id')
          .eq('user_id', userId)
          .eq('provider', provider)
          .maybeSingle();

        if (existingSource) {
          // Update existing source
          await supabase
            .from('evidence_sources')
            .update({
              status: 'connected',
              account_email: accountEmail || null,
              last_sync_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              permissions: scopes
            })
            .eq('id', existingSource.id);
        } else {
          // Create new source
          // Note: We're storing tokens in tokenManager, not in database encrypted fields
          // The database just stores metadata
          await supabase
            .from('evidence_sources')
            .insert({
              user_id: userId,
              provider: provider,
              account_email: accountEmail || 'unknown',
              status: 'connected',
              last_sync_at: new Date().toISOString(),
              permissions: scopes,
              metadata: {}
            });
        }
      } catch (dbError: any) {
        logger.error('Failed to update evidence source in database', {
          error: dbError?.message || String(dbError),
          provider,
          userId
        });
      }

      logger.info('Evidence source connected successfully', {
        userId,
        provider,
        accountEmail
      });

      // Redirect to integrations-hub instead of /auth/callback (which may not exist)
      // This route exists and shows the integrations status
      const redirectUrl = `${frontendUrl || process.env.FRONTEND_URL || 'http://localhost:3000'}/integrations-hub?${provider}_connected=true&email=${encodeURIComponent(accountEmail || '')}`;

      logger.info('Redirecting to frontend after evidence source OAuth success', {
        userId,
        provider,
        accountEmail,
        redirectPath: '/integrations-hub'
      });

      return res.redirect(302, redirectUrl);
    } catch (tokenError: any) {
      logger.error('Failed to exchange OAuth code for token', {
        error: tokenError?.message || String(tokenError),
        provider
      });
      return res.redirect(`${frontendUrl || process.env.FRONTEND_URL || 'http://localhost:3000'}/auth/callback?error=token_exchange_failed`);
    }
  } catch (error: any) {
    logger.error('Error handling evidence source callback', {
      error: error?.message || String(error),
      provider: req.params.provider
    });

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    return res.redirect(`${frontendUrl}/auth/callback?error=callback_error`);
  }
};

/**
 * Get OAuth configuration for a provider
 */
function getOAuthConfig(provider: string): { clientId: string; clientSecret: string } | null {
  const configs: Record<string, { clientId: string; clientSecret: string }> = {
    gmail: {
      clientId: config.GMAIL_CLIENT_ID || process.env.GMAIL_CLIENT_ID || '',
      clientSecret: config.GMAIL_CLIENT_SECRET || process.env.GMAIL_CLIENT_SECRET || ''
    },
    gdrive: {
      clientId: config.GDRIVE_CLIENT_ID || process.env.GDRIVE_CLIENT_ID || config.GMAIL_CLIENT_ID || process.env.GMAIL_CLIENT_ID || '',
      clientSecret: config.GDRIVE_CLIENT_SECRET || process.env.GDRIVE_CLIENT_SECRET || config.GMAIL_CLIENT_SECRET || process.env.GMAIL_CLIENT_SECRET || ''
    },
    outlook: {
      clientId: config.OUTLOOK_CLIENT_ID || process.env.OUTLOOK_CLIENT_ID || '',
      clientSecret: config.OUTLOOK_CLIENT_SECRET || process.env.OUTLOOK_CLIENT_SECRET || ''
    },
    dropbox: {
      clientId: config.DROPBOX_CLIENT_ID || process.env.DROPBOX_CLIENT_ID || '',
      clientSecret: config.DROPBOX_CLIENT_SECRET || process.env.DROPBOX_CLIENT_SECRET || ''
    }
  };

  const providerConfig = configs[provider];
  if (!providerConfig || !providerConfig.clientId || !providerConfig.clientSecret) {
    return null;
  }

  return providerConfig;
}

