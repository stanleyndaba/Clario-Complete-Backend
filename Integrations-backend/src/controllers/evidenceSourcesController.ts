/**
 * Evidence Sources Controller
 * Handles OAuth connection for evidence providers (Gmail, Outlook, Google Drive, Dropbox, OneDrive, Adobe Sign, Slack)
 */

import { Request, Response } from 'express';
import axios from 'axios';
import crypto from 'crypto';
import logger from '../utils/logger';
import config from '../config/env';
import tokenManager from '../utils/tokenManager';
import oauthStateStore from '../utils/oauthStateStore';
import { supabase, supabaseAdmin, convertUserIdToUuid } from '../database/supabaseClient';
import { getManagedTokenSourceFields } from '../utils/evidenceSourceRecordShape';

// OAuth URLs for different providers
const OAUTH_URLS = {
  gmail: {
    auth: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
    scopes: [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.modify',
      'https://www.googleapis.com/auth/gmail.send'
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
  },
  onedrive: {
    auth: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    token: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scopes: [
      'https://graph.microsoft.com/Files.Read',
      'https://graph.microsoft.com/Files.Read.All',
      'offline_access'
    ]
  },
  adobe_sign: {
    auth: 'https://secure.na1.adobesign.com/public/oauth/v2',
    token: 'https://api.na1.adobesign.com/oauth/v2/token',
    scopes: [
      'agreement_read',
      'agreement_write'
    ]
  },
  slack: {
    auth: 'https://slack.com/oauth/v2/authorize',
    token: 'https://slack.com/api/oauth.v2.access',
    scopes: [
      'files:read',
      'channels:read',
      'groups:read',
      'users:read',
      'users:read.email'
    ]
  }
};

function getProviderRedirectUri(provider: string, req: Request): string {
  const configuredRedirectUri = provider === 'slack'
    ? (config.SLACK_REDIRECT_URI || process.env.SLACK_REDIRECT_URI || '').trim()
    : '';

  if (configuredRedirectUri) {
    return configuredRedirectUri;
  }

  return `${resolveBackendCallbackBase(req)}/api/v1/integrations/${provider}/callback`;
}

/**
 * Connect evidence source - Generate OAuth URL
 * POST /api/v1/integrations/{provider}/connect
 */
export const connectEvidenceSource = async (req: Request, res: Response) => {
  try {
    const { provider } = req.params;
    const frontendUrl = req.query.frontend_url as string;
    const tenantSlug = (req.query.tenant_slug as string) || (req.query.tenantSlug as string);
    const storeId = (req.query.store_id as string) || (req.query.storeId as string);

    // Support both userIdMiddleware and auth middleware
    const userId = (req as any).userId || (req as any).user?.id || (req as any).user?.user_id;

    if (!userId) {
      return res.status(401).json({
        ok: false,
        error: 'Authentication required'
      });
    }

    // Validate provider
    const validProviders = ['gmail', 'outlook', 'gdrive', 'dropbox', 'onedrive', 'adobe_sign', 'slack'];
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
    const defaultRedirectUri = getProviderRedirectUri(provider, req);
    const callbackRedirectUri = defaultRedirectUri;

    let normalizedFrontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    if (frontendUrl) {
      try {
        const parsed = new URL(frontendUrl);
        normalizedFrontendUrl = `${parsed.protocol}//${parsed.host}`;
      } catch {
        logger.warn('Invalid frontend_url provided for evidence source OAuth, falling back to FRONTEND_URL', {
          provider,
          frontendUrl
        });
      }
    }

    // Generate state for CSRF protection
    const state = crypto.randomBytes(32).toString('hex');
    await oauthStateStore.setState(
      state,
      userId,
      normalizedFrontendUrl,
      tenantSlug,
      undefined,
      storeId,
      defaultRedirectUri
    );

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
    } else if (provider === 'onedrive') {
      // Microsoft OAuth (OneDrive) - same flow as Outlook
      const scopes = OAUTH_URLS[provider].scopes.join(' ');
      authUrl = `${OAUTH_URLS[provider].auth}?` +
        `client_id=${encodeURIComponent(oauthConfig.clientId)}&` +
        `redirect_uri=${encodeURIComponent(defaultRedirectUri)}&` +
        `response_type=code&` +
        `scope=${encodeURIComponent(scopes)}&` +
        `response_mode=query&` +
        `state=${state}`;
    } else if (provider === 'adobe_sign') {
      // Adobe Sign OAuth
      const scopes = OAUTH_URLS[provider].scopes.join('+');
      authUrl = `${OAUTH_URLS[provider].auth}?` +
        `client_id=${encodeURIComponent(oauthConfig.clientId)}&` +
        `redirect_uri=${encodeURIComponent(defaultRedirectUri)}&` +
        `response_type=code&` +
        `scope=${encodeURIComponent(scopes)}&` +
        `state=${state}`;
    } else if (provider === 'slack') {
      // Slack OAuth v2
      const scopes = OAUTH_URLS[provider].scopes.join(',');
      authUrl = `${OAUTH_URLS[provider].auth}?` +
        `client_id=${encodeURIComponent(oauthConfig.clientId)}&` +
        `redirect_uri=${encodeURIComponent(defaultRedirectUri)}&` +
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
      frontendUrl: normalizedFrontendUrl,
      redirectUri: callbackRedirectUri,
      oauthRedirectUri: defaultRedirectUri,
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
      return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/auth/success?status=error&provider=${encodeURIComponent(provider)}&error=${encodeURIComponent(error as string)}`);
    }

    if (!code || !state) {
      return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/auth/success?status=error&provider=${encodeURIComponent(provider)}&error=missing_code_or_state`);
    }

    // Verify state
    const stateData = await oauthStateStore.get(state as string);
    if (!stateData || !stateData.userId) {
      return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/auth/success?status=error&provider=${encodeURIComponent(provider)}&error=invalid_state`);
    }

    const userId = stateData.userId;
    const dbUserId = convertUserIdToUuid(userId);
    const frontendUrl = stateData.frontendUrl || process.env.FRONTEND_URL || 'http://localhost:3000';
    const tenantSlug = stateData.tenantSlug;
    const storeId = stateData.storeId;
    const tenantSuccessPath = tenantSlug ? `/app/${tenantSlug}/auth/success` : '/auth/success';
    const adminClient = supabaseAdmin || supabase;

    await oauthStateStore.delete(state as string);

    // Resolve tenantId if we have a slug
    let tenantId: string | undefined = undefined;
    if (tenantSlug) {
      try {
        const { data: tenant } = await adminClient
          .from('tenants')
          .select('id')
          .eq('slug', tenantSlug)
          .maybeSingle();

        if (tenant) {
          tenantId = tenant.id;
        }
      } catch (err) {
        logger.warn('Failed to resolve tenant ID from slug in evidence source callback', { slug: tenantSlug });
      }
    }

    if (tenantSlug && !tenantId) {
      logger.error('Evidence source callback could not resolve tenant from OAuth state; refusing tenantless persistence', {
        provider,
        userId,
        tenantSlug
      });
      return res.redirect(`${frontendUrl}${tenantSuccessPath}?status=error&provider=${encodeURIComponent(provider)}&error=tenant_resolution_failed&tenant_slug=${encodeURIComponent(tenantSlug)}`);
    }

    // Get OAuth configuration
    const oauthConfig = getOAuthConfig(provider);
    if (!oauthConfig) {
      return res.redirect(`${frontendUrl}${tenantSuccessPath}?status=error&provider=${encodeURIComponent(provider)}&error=oauth_config_not_found${tenantSlug ? `&tenant_slug=${encodeURIComponent(tenantSlug)}` : ''}`);
    }

    // Exchange code for token
    const redirectUri = stateData.redirectUri || getProviderRedirectUri(provider, req);

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
      } else if (provider === 'onedrive') {
        // Microsoft OAuth token exchange (same as Outlook)
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
      } else if (provider === 'adobe_sign') {
        // Adobe Sign OAuth token exchange
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
      } else if (provider === 'slack') {
        // Slack OAuth v2 token exchange
        tokenResponse = await axios.post(OAUTH_URLS[provider].token, new URLSearchParams({
          client_id: oauthConfig.clientId,
          client_secret: oauthConfig.clientSecret,
          code: code as string,
          redirect_uri: redirectUri
        }), {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        });
      } else {
        return res.redirect(`${frontendUrl}${tenantSuccessPath}?status=error&provider=${encodeURIComponent(provider)}&error=unsupported_provider${tenantSlug ? `&tenant_slug=${encodeURIComponent(tenantSlug)}` : ''}`);
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
          }, tenantId, storeId);
          logger.info('Gmail token saved successfully', { userId, tenantId, storeId });
        } catch (tokenError: any) {
          logger.error('CRITICAL: Failed to store Gmail token', {
            error: tokenError?.message || String(tokenError),
            userId,
            provider
          });
          // This is a critical error - without the token, Gmail won't work
          // Return error to user instead of silently continuing
          return res.redirect(`${frontendUrl}${tenantSuccessPath}?status=error&provider=${encodeURIComponent(provider)}&error=${encodeURIComponent('Failed to save Gmail token. Please try reconnecting.')}${tenantSlug ? `&tenant_slug=${encodeURIComponent(tenantSlug)}` : ''}`);
        }
      } else {
        // For other providers (outlook, gdrive, dropbox), store in token manager as well
        try {
          // Map provider to what tokenManager expects if necessary
          const tokenProvider = provider === 'gdrive' ? 'gdrive' : (provider as any);

          await tokenManager.saveToken(userId, tokenProvider, {
            accessToken: access_token,
            refreshToken: refresh_token || '',
            expiresAt: expires_in ? new Date(Date.now() + expires_in * 1000) : new Date(Date.now() + 3600 * 1000)
          }, tenantId, storeId);
          logger.info('Token stored for provider', { provider, userId, tenantId, storeId });
        } catch (tokenError: any) {
          logger.error(`Failed to store ${provider} token`, {
            error: tokenError?.message || String(tokenError),
            userId,
            provider
          });
        }
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
        } else if (provider === 'onedrive') {
          const profileResponse = await axios.get('https://graph.microsoft.com/v1.0/me', {
            headers: { 'Authorization': `Bearer ${access_token}` }
          });
          accountEmail = profileResponse.data.mail || profileResponse.data.userPrincipalName;
        } else if (provider === 'adobe_sign') {
          // Adobe Sign doesn't have a simple profile endpoint; use email from token response if available
          accountEmail = tokenResponse.data?.email || tokenResponse.data?.userEmail;
        } else if (provider === 'slack') {
          // Slack v2 OAuth returns authed_user info
          const slackData = tokenResponse.data;
          if (slackData?.authed_user?.id) {
            try {
              const userResponse = await axios.get('https://slack.com/api/users.info', {
                headers: { 'Authorization': `Bearer ${access_token}` },
                params: { user: slackData.authed_user.id }
              });
              accountEmail = userResponse.data?.user?.profile?.email;
            } catch (slackProfileError) {
              logger.warn('Failed to fetch Slack user profile', { error: slackProfileError });
            }
          }
        }
      } catch (profileError) {
        logger.warn('Failed to fetch user profile', { provider, error: profileError });
      }

      // Get OAuth scopes for provider
      const scopes = OAUTH_URLS[provider]?.scopes || [];

      // Create or update evidence source in database
      try {
        let existingSourceQuery = adminClient
          .from('evidence_sources')
          .select('id')
          .eq('user_id', dbUserId)
          .eq('provider', provider);

        existingSourceQuery = tenantId
          ? existingSourceQuery.eq('tenant_id', tenantId)
          : existingSourceQuery.is('tenant_id', null);

        const { data: existingSource } = await existingSourceQuery.maybeSingle();

        const sourceMetadata = {
          access_token,
          refresh_token: refresh_token || undefined,
          expires_at: expires_in ? new Date(Date.now() + expires_in * 1000).toISOString() : undefined,
          connected_at: new Date().toISOString(),
          source: `${provider}_oauth`,
          token_source: 'oauth_callback'
        };

        if (existingSource) {
          // Update existing source
          await adminClient
            .from('evidence_sources')
            .update({
              status: 'connected',
              account_email: accountEmail || null,
              ...getManagedTokenSourceFields(!!refresh_token),
              updated_at: new Date().toISOString(),
              permissions: scopes,
              metadata: sourceMetadata,
              tenant_id: tenantId || null,
              store_id: storeId || null
            })
            .eq('id', existingSource.id);
        } else {
          // Create new source
          // Note: We're storing tokens in tokenManager, not in database encrypted fields
          // The database just stores metadata
          await adminClient
            .from('evidence_sources')
            .insert({
              user_id: dbUserId,
              seller_id: dbUserId,
              provider: provider,
              account_email: accountEmail || 'unknown',
              status: 'connected',
              ...getManagedTokenSourceFields(!!refresh_token),
              permissions: scopes,
              metadata: sourceMetadata,
              tenant_id: tenantId || null,
              store_id: storeId || null
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

      const redirectUrl = `${frontendUrl}${tenantSuccessPath}?status=ok&provider=${encodeURIComponent(provider)}&${provider}_connected=true&email=${encodeURIComponent(accountEmail || '')}${tenantSlug ? `&tenant_slug=${encodeURIComponent(tenantSlug)}` : ''}`;

      logger.info('Redirecting to frontend after evidence source OAuth success', {
        userId,
        provider,
        accountEmail,
        redirectPath: tenantSuccessPath
      });

      return res.redirect(302, redirectUrl);
    } catch (tokenError: any) {
      logger.error('Failed to exchange OAuth code for token', {
        error: tokenError?.message || String(tokenError),
        provider
      });
      return res.redirect(`${frontendUrl}${tenantSuccessPath}?status=error&provider=${encodeURIComponent(provider)}&error=token_exchange_failed${tenantSlug ? `&tenant_slug=${encodeURIComponent(tenantSlug)}` : ''}`);
    }
  } catch (error: any) {
    logger.error('Error handling evidence source callback', {
      error: error?.message || String(error),
      provider: req.params.provider
    });

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    return res.redirect(`${frontendUrl}/auth/success?status=error&provider=${encodeURIComponent(req.params.provider)}&error=callback_error`);
  }
};

function resolveBackendCallbackBase(req: Request): string {
  const requestHost = req.get('host');
  const requestProtocol = req.protocol || 'http';

  if (requestHost) {
    return `${requestProtocol}://${requestHost}`;
  }

  return process.env.INTEGRATIONS_URL || process.env.VITE_API_BASE_URL || 'http://localhost:3001';
}

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
    },
    onedrive: {
      clientId: config.ONEDRIVE_CLIENT_ID || process.env.ONEDRIVE_CLIENT_ID || '',
      clientSecret: config.ONEDRIVE_CLIENT_SECRET || process.env.ONEDRIVE_CLIENT_SECRET || ''
    },
    adobe_sign: {
      clientId: config.ADOBESIGN_CLIENT_ID || process.env.ADOBESIGN_CLIENT_ID || '',
      clientSecret: config.ADOBESIGN_CLIENT_SECRET || process.env.ADOBESIGN_CLIENT_SECRET || ''
    },
    slack: {
      clientId: config.SLACK_CLIENT_ID || process.env.SLACK_CLIENT_ID || '',
      clientSecret: config.SLACK_CLIENT_SECRET || process.env.SLACK_CLIENT_SECRET || ''
    }
  };

  const providerConfig = configs[provider];
  if (!providerConfig || !providerConfig.clientId || !providerConfig.clientSecret) {
    return null;
  }

  return providerConfig;
}

