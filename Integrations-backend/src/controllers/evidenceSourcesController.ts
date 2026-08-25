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
    scopes: ['files.content.read', 'files.metadata.read', 'account_info.read']
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
      'user_login:self',
      'agreement_read:self'
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
  },
  quickbooks: {
    // Intuit uses the same authorization endpoint for sandbox and production.
    auth: 'https://appcenter.intuit.com/connect/oauth2',
    token: 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
    scopes: ['com.intuit.quickbooks.accounting', 'openid', 'profile', 'email']
  },
  xero: {
    auth: 'https://login.xero.com/identity/connect/authorize',
    token: 'https://identity.xero.com/connect/token',
    scopes: [
      'openid', 'profile', 'email',
      'accounting.invoices.read',
      'offline_access'
    ]
  }
};

function getProviderRedirectUri(provider: string, req: Request): string {
  let configuredRedirectUri = '';
  if (provider === 'slack') {
    configuredRedirectUri = config.SLACK_REDIRECT_URI || process.env.SLACK_REDIRECT_URI || '';
  } else if (provider === 'dropbox') {
    configuredRedirectUri = config.DROPBOX_REDIRECT_URI || process.env.DROPBOX_REDIRECT_URI || '';
  } else if (provider === 'adobe_sign') {
    configuredRedirectUri = config.ADOBESIGN_REDIRECT_URI || process.env.ADOBESIGN_REDIRECT_URI || '';
  } else if (provider === 'quickbooks') {
    configuredRedirectUri = config.QUICKBOOKS_REDIRECT_URI || process.env.QUICKBOOKS_REDIRECT_URI || '';
  } else if (provider === 'xero') {
    configuredRedirectUri = config.XERO_REDIRECT_URI || process.env.XERO_REDIRECT_URI || '';
  }
  configuredRedirectUri = configuredRedirectUri.trim();

  if (configuredRedirectUri) {
    return configuredRedirectUri;
  }

  return `${resolveBackendCallbackBase(req)}/api/v1/integrations/${provider}/callback`;
}

function allowedFrontendOrigins(): string[] {
  return [
    process.env.FRONTEND_URL,
    process.env.PUBLIC_FRONTEND_URL,
    ...(process.env.ALLOWED_FRONTEND_ORIGINS || process.env.CORS_ALLOW_ORIGINS || '').split(',')
  ]
    .map((value) => String(value || '').trim().replace(/\/$/, ''))
    .filter((value, index, all) => Boolean(value) && all.indexOf(value) === index);
}

function validateFrontendOrigin(candidate: string | undefined): string {
  const configured = allowedFrontendOrigins();
  const fallback = configured[0] || (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:3000');
  if (!candidate) {
    if (!fallback) throw new Error('OAUTH_FRONTEND_ORIGIN_NOT_CONFIGURED');
    return fallback;
  }

  let origin: string;
  try {
    const parsed = new URL(candidate);
    origin = `${parsed.protocol}//${parsed.host}`;
  } catch {
    throw new Error('OAUTH_FRONTEND_ORIGIN_INVALID');
  }

  if (configured.includes(origin)) return origin;
  if (process.env.NODE_ENV !== 'production' && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) return origin;
  throw new Error('OAUTH_FRONTEND_ORIGIN_NOT_ALLOWED');
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
    const validProviders = ['gmail', 'outlook', 'gdrive', 'dropbox', 'onedrive', 'adobe_sign', 'slack', 'quickbooks', 'xero'];
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

    const normalizedFrontendUrl = validateFrontendOrigin(frontendUrl);

    // Generate state for CSRF protection
    const state = crypto.randomBytes(32).toString('hex');
    await oauthStateStore.setState(
      state,
      userId,
      normalizedFrontendUrl,
      tenantSlug,
      undefined,
      storeId,
      defaultRedirectUri,
      undefined,
      undefined,
      undefined,
      provider
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
        `token_access_type=offline&` +
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
    } else if (provider === 'quickbooks') {
      // QuickBooks OAuth
      const scopes = OAUTH_URLS[provider].scopes.join(' ');
      authUrl = `${OAUTH_URLS[provider].auth}?` +
        `client_id=${encodeURIComponent(oauthConfig.clientId)}&` +
        `redirect_uri=${encodeURIComponent(defaultRedirectUri)}&` +
        `response_type=code&` +
        `scope=${encodeURIComponent(scopes)}&` +
        `state=${state}`;
    } else if (provider === 'xero') {
      // Xero OAuth
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
    const { code, state, error, api_access_point, web_access_point } = req.query;

    if (error) {
      logger.warn('OAuth callback error', { provider, error });
      return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/auth/success?status=error&provider=${encodeURIComponent(provider)}&error=${encodeURIComponent(error as string)}`);
    }

    if (!code || !state) {
      return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/auth/success?status=error&provider=${encodeURIComponent(provider)}&error=missing_code_or_state`);
    }

    // Consume the state atomically before token exchange. A callback may never
    // reuse state, switch providers, or fall back to request-controlled context.
    const stateData = await oauthStateStore.consume(state as string);
    if (!stateData || !stateData.userId || stateData.provider !== provider) {
      return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/auth/success?status=error&provider=${encodeURIComponent(provider)}&error=invalid_state`);
    }

    const userId = stateData.userId;
    const dbUserId = convertUserIdToUuid(userId);
    const frontendUrl = validateFrontendOrigin(stateData.frontendUrl);
    const tenantSlug = stateData.tenantSlug;
    const storeId = stateData.storeId;
    const tenantSuccessPath = tenantSlug ? `/app/${tenantSlug}/auth/success` : '/auth/success';
    const adminClient = supabaseAdmin || supabase;

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

    if (tenantId) {
      const { data: membership, error: membershipError } = await adminClient
        .from('tenant_memberships')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('user_id', dbUserId)
        .eq('is_active', true)
        .is('deleted_at', null)
        .maybeSingle();
      if (membershipError || !membership) {
        logger.warn('OAuth callback rejected because workspace membership is no longer active', { provider, tenantId, userId });
        return res.redirect(`${frontendUrl}${tenantSuccessPath}?status=error&provider=${encodeURIComponent(provider)}&error=tenant_access_revoked${tenantSlug ? `&tenant_slug=${encodeURIComponent(tenantSlug)}` : ''}`);
      }
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
      } else if (provider === 'quickbooks') {
        // QuickBooks OAuth token exchange
        tokenResponse = await axios.post(OAUTH_URLS[provider].token, new URLSearchParams({
          client_id: oauthConfig.clientId,
          client_secret: oauthConfig.clientSecret,
          code: code as string,
          grant_type: 'authorization_code',
          redirect_uri: redirectUri
        }), {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'application/json'
          }
        });
      } else if (provider === 'xero') {
        // Xero OAuth token exchange
        const basicAuth = Buffer.from(`${oauthConfig.clientId}:${oauthConfig.clientSecret}`).toString('base64');
        tokenResponse = await axios.post(OAUTH_URLS[provider].token, new URLSearchParams({
          grant_type: 'authorization_code',
          code: code as string,
          redirect_uri: redirectUri
        }), {
          headers: {
            'Authorization': `Basic ${basicAuth}`,
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
      let xeroTenantId: string | undefined;
      let xeroOrganisationOptions: Array<{ tenantId: string; tenantName: string | null }> = [];
      let qboRealmId: string | undefined;

      if (provider === 'quickbooks') {
        qboRealmId = req.query.realmId as string;
      }

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
        } else if (provider === 'quickbooks') {
          // Intuit uses distinct account hosts for sandbox and production identity.
          const quickBooksUserInfoEndpoint = config.QUICKBOOKS_ENVIRONMENT === 'sandbox'
            ? 'https://sandbox-accounts.platform.intuit.com/v1/openid_connect/userinfo'
            : 'https://accounts.platform.intuit.com/v1/openid_connect/userinfo';
          const profileResponse = await axios.get(quickBooksUserInfoEndpoint, {
            headers: { 'Authorization': `Bearer ${access_token}` }
          });
          accountEmail = profileResponse.data.email;
        } else if (provider === 'xero') {
          // A seller may authorize several Xero organisations. Do not silently
          // bind the first response; persist choices and require explicit choice
          // unless the provider returned exactly one accessible organisation.
          const connectionsResponse = await axios.get('https://api.xero.com/connections', {
            headers: { 'Authorization': `Bearer ${access_token}` }
          });
          xeroOrganisationOptions = (Array.isArray(connectionsResponse.data) ? connectionsResponse.data : [])
            .filter((connection: any) => typeof connection?.tenantId === 'string' && connection.tenantId.trim())
            .map((connection: any) => ({
              tenantId: String(connection.tenantId),
              tenantName: typeof connection.tenantName === 'string' && connection.tenantName.trim()
                ? connection.tenantName.trim()
                : null
            }));
          if (!xeroOrganisationOptions.length) {
            throw new Error('Xero did not return an accessible organisation connection.');
          }
          if (xeroOrganisationOptions.length === 1) {
            xeroTenantId = xeroOrganisationOptions[0].tenantId;
            accountEmail = xeroOrganisationOptions[0].tenantName || undefined;
          } else {
            accountEmail = 'Xero organisation selection required';
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
          // OAuth credentials are stored only by tokenManager in encrypted token columns.
          // Metadata is intentionally non-secret and may be inspected by connection-status flows.
          expires_at: expires_in ? new Date(Date.now() + expires_in * 1000).toISOString() : undefined,
          connected_at: new Date().toISOString(),
          source: `${provider}_oauth`,
          token_source: 'oauth_callback',
          ...(provider === 'adobe_sign' && typeof api_access_point === 'string' && api_access_point
            ? { api_access_point }
            : {}),
          ...(provider === 'adobe_sign' && typeof web_access_point === 'string' && web_access_point
            ? { web_access_point }
            : {}),
          ...(qboRealmId ? { realm_id: qboRealmId } : {}),
          ...(xeroTenantId ? { xero_tenant_id: xeroTenantId } : {}),
          ...(provider === 'xero' ? { xero_organisations: xeroOrganisationOptions } : {})
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
              ...(provider === 'quickbooks' || provider === 'xero'
                ? {
                    accounting_read_status: 'pending',
                    accounting_last_read_at: null,
                    accounting_last_error: null,
                    accounting_record_count: 0
                  }
                : {}),
              tenant_id: tenantId || null,
              store_id: storeId || null,
              ...(provider === 'xero' ? {
                accounting_organisation_id: xeroTenantId || null,
                accounting_organisation_name: xeroTenantId ? (xeroOrganisationOptions.find((item) => item.tenantId === xeroTenantId)?.tenantName || null) : null,
                accounting_organisation_selected_at: xeroTenantId ? new Date().toISOString() : null
              } : {})
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
              ...(provider === 'quickbooks' || provider === 'xero'
                ? {
                    accounting_read_status: 'pending',
                    accounting_last_read_at: null,
                    accounting_last_error: null,
                    accounting_record_count: 0
                  }
                : {}),
              tenant_id: tenantId || null,
              store_id: storeId || null,
              ...(provider === 'xero' ? {
                accounting_organisation_id: xeroTenantId || null,
                accounting_organisation_name: xeroTenantId ? (xeroOrganisationOptions.find((item) => item.tenantId === xeroTenantId)?.tenantName || null) : null,
                accounting_organisation_selected_at: xeroTenantId ? new Date().toISOString() : null
              } : {})
            });
        }
      } catch (dbError: any) {
        logger.error('Failed to update evidence source in database', {
          error: dbError?.message || String(dbError),
          provider,
          userId
        });
        if (provider === 'quickbooks' || provider === 'xero') {
          return res.redirect(`${frontendUrl}${tenantSuccessPath}?status=error&provider=${encodeURIComponent(provider)}&error=connection_persistence_failed${tenantSlug ? `&tenant_slug=${encodeURIComponent(tenantSlug)}` : ''}`);
        }
      }

      if ((provider === 'quickbooks' || (provider === 'xero' && xeroTenantId)) && tenantId) {
        const { addAccountingSyncJob } = await import('../queues/ingestionQueue');
        const jobId = await addAccountingSyncJob(userId, tenantId, provider as 'quickbooks' | 'xero', 'oauth_initial');

        if (!jobId) {
          const schedulingError = 'Margin could not schedule the first financial evidence verification. Reconnect or contact support before relying on this source.';
          await adminClient
            .from('evidence_sources')
            .update({
              accounting_read_status: 'failed',
              accounting_last_error: schedulingError,
              updated_at: new Date().toISOString()
            })
            .eq('user_id', dbUserId)
            .eq('tenant_id', tenantId)
            .eq('provider', provider);
          logger.error('Accounting connection persisted but initial provider read could not be scheduled', {
            provider,
            userId,
            tenantId
          });
        }
      }

      logger.info('Evidence source connected successfully', {
        userId,
        provider,
        accountEmail
      });

      const xeroSelectionRequired = provider === 'xero' && xeroOrganisationOptions.length > 1 && !xeroTenantId;
      const redirectUrl = `${frontendUrl}${tenantSuccessPath}?status=ok&provider=${encodeURIComponent(provider)}&${provider}_connected=true&email=${encodeURIComponent(accountEmail || '')}${xeroSelectionRequired ? '&xero_organisation_selection_required=true' : ''}${tenantSlug ? `&tenant_slug=${encodeURIComponent(tenantSlug)}` : ''}`;

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

export const listXeroOrganisations = async (req: Request, res: Response) => {
  const userId = (req as any).userId || (req as any).user?.id;
  const tenantId = (req as any).tenant?.tenantId || (req as any).tenantId;
  if (!userId || !tenantId) return res.status(403).json({ ok: false, error: 'Active workspace identity is required.' });
  const dbUserId = convertUserIdToUuid(userId);
  const adminClient = supabaseAdmin || supabase;
  const { data: source, error } = await adminClient
    .from('evidence_sources')
    .select('id, account_email, accounting_organisation_id, accounting_organisation_name, accounting_organisation_selected_at, metadata')
    .eq('tenant_id', tenantId)
    .eq('user_id', dbUserId)
    .eq('provider', 'xero')
    .maybeSingle();
  if (error || !source) return res.status(404).json({ ok: false, error: 'Connected Xero source not found.' });

  const rawOptions = Array.isArray(source.metadata?.xero_organisations) ? source.metadata.xero_organisations : [];
  const organisations = rawOptions
    .filter((item: any) => typeof item?.tenantId === 'string' && item.tenantId.trim())
    .map((item: any) => ({ tenantId: item.tenantId, tenantName: typeof item.tenantName === 'string' ? item.tenantName : null }));
  return res.json({
    ok: true,
    data: {
      sourceId: source.id,
      selectedOrganisationId: source.accounting_organisation_id || null,
      selectedOrganisationName: source.accounting_organisation_name || null,
      selectedAt: source.accounting_organisation_selected_at || null,
      organisations
    }
  });
};

export const selectXeroOrganisation = async (req: Request, res: Response) => {
  const userId = (req as any).userId || (req as any).user?.id;
  const tenantId = (req as any).tenant?.tenantId || (req as any).tenantId;
  const organisationId = String((req.body as any)?.organisationId || '').trim();
  if (!userId || !tenantId) return res.status(403).json({ ok: false, error: 'Active workspace identity is required.' });
  if (!organisationId) return res.status(400).json({ ok: false, error: 'organisationId is required.' });

  const dbUserId = convertUserIdToUuid(userId);
  const adminClient = supabaseAdmin || supabase;
  const { data: source, error } = await adminClient
    .from('evidence_sources')
    .select('id, metadata')
    .eq('tenant_id', tenantId)
    .eq('user_id', dbUserId)
    .eq('provider', 'xero')
    .maybeSingle();
  if (error || !source) return res.status(404).json({ ok: false, error: 'Connected Xero source not found.' });

  const choices = Array.isArray(source.metadata?.xero_organisations) ? source.metadata.xero_organisations : [];
  const choice = choices.find((item: any) => item?.tenantId === organisationId);
  if (!choice) return res.status(400).json({ ok: false, error: 'The selected Xero organisation is not part of this authorised connection.' });

  const now = new Date().toISOString();
  const metadata = { ...(source.metadata || {}), xero_tenant_id: organisationId, xero_organisation_selected_at: now };
  const organisationName = typeof choice.tenantName === 'string' ? choice.tenantName : null;
  const { error: updateError } = await adminClient
    .from('evidence_sources')
    .update({
      metadata,
      account_email: organisationName || null,
      accounting_organisation_id: organisationId,
      accounting_organisation_name: organisationName,
      accounting_organisation_selected_at: now,
      accounting_read_status: 'pending',
      accounting_last_error: null,
      updated_at: now
    })
    .eq('id', source.id)
    .eq('tenant_id', tenantId)
    .eq('user_id', dbUserId)
    .eq('provider', 'xero');
  if (updateError) return res.status(500).json({ ok: false, error: 'Unable to persist the selected Xero organisation.' });

  const { addAccountingSyncJob } = await import('../queues/ingestionQueue');
  const jobId = await addAccountingSyncJob(userId, tenantId, 'xero', 'manual');
  if (!jobId) {
    await adminClient.from('evidence_sources')
      .update({ accounting_read_status: 'failed', accounting_last_error: 'Margin could not schedule Xero financial evidence verification.', updated_at: new Date().toISOString() })
      .eq('id', source.id)
      .eq('tenant_id', tenantId);
    return res.status(503).json({ ok: false, error: 'The organisation was selected, but verification could not be scheduled.' });
  }

  return res.status(202).json({ ok: true, data: { organisationId, organisationName, syncJobId: jobId } });
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
    },
    quickbooks: {
      clientId: config.QUICKBOOKS_CLIENT_ID || process.env.QUICKBOOKS_CLIENT_ID || '',
      clientSecret: config.QUICKBOOKS_CLIENT_SECRET || process.env.QUICKBOOKS_CLIENT_SECRET || ''
    },
    xero: {
      clientId: config.XERO_CLIENT_ID || process.env.XERO_CLIENT_ID || '',
      clientSecret: config.XERO_CLIENT_SECRET || process.env.XERO_CLIENT_SECRET || ''
    }
  };

  const providerConfig = configs[provider];
  if (!providerConfig || !providerConfig.clientId || !providerConfig.clientSecret) {
    return null;
  }

  return providerConfig;
}

