import { Request, Response } from 'express';
import axios from 'axios';
import crypto from 'crypto';
import logger from '../utils/logger';
import config from '../config/env';
import tokenManager from '../utils/tokenManager';
import oauthStateStore from '../utils/oauthStateStore';

// Microsoft OAuth URLs
const MICROSOFT_AUTH_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
const MICROSOFT_TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
const GRAPH_API_URL = 'https://graph.microsoft.com/v1.0';

export const initiateOutlookOAuth = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.id || (req as any).userId ||
            (req as any).headers['x-user-id'] ||
            (req as any).headers['x-forwarded-user-id'];

        if (!userId) {
            return res.status(401).json({
                success: false,
                error: 'Authentication required'
            });
        }

        // Get frontend URL from request
        const frontendUrlFromQuery = (req as any).query?.frontend_url as string;
        const frontendUrlFromHeader = (req as any).headers?.['x-frontend-url'] as string;
        const referer = (req as any).headers?.referer as string;

        let frontendUrl = frontendUrlFromQuery ||
            frontendUrlFromHeader ||
            (referer ? new URL(referer).origin : null) ||
            process.env.FRONTEND_URL ||
            'http://localhost:3000';

        try {
            const url = new URL(frontendUrl);
            frontendUrl = `${url.protocol}//${url.host}`;
        } catch {
            frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
        }

        const clientId = config.MICROSOFT_CLIENT_ID || process.env.MICROSOFT_CLIENT_ID;
        const redirectUri = config.MICROSOFT_REDIRECT_URI || process.env.MICROSOFT_REDIRECT_URI ||
            `${process.env.INTEGRATIONS_URL || 'http://localhost:3001'}/api/v1/integrations/outlook/callback`;

        if (!clientId || !config.MICROSOFT_CLIENT_SECRET) {
            logger.warn('Microsoft credentials not configured, returning sandbox mock URL');
            const mockAuthUrl = `${MICROSOFT_AUTH_URL}?client_id=mock-client-id&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=Mail.Read`;

            return res.json({
                success: true,
                authUrl: mockAuthUrl,
                message: 'Outlook OAuth flow initiated (sandbox mode - credentials not configured)',
                sandbox: true
            });
        }

        // Generate state for CSRF protection
        const state = crypto.randomBytes(32).toString('hex');
        await oauthStateStore.setState(state, userId, frontendUrl);

        // Microsoft OAuth scopes for Outlook
        const scopes = [
            'https://graph.microsoft.com/Mail.Read',
            'https://graph.microsoft.com/User.Read',
            'offline_access'
        ].join(' ');

        // Build OAuth URL
        const authUrl = `${MICROSOFT_AUTH_URL}?` +
            `client_id=${encodeURIComponent(clientId)}&` +
            `redirect_uri=${encodeURIComponent(redirectUri)}&` +
            `response_type=code&` +
            `scope=${encodeURIComponent(scopes)}&` +
            `response_mode=query&` +
            `state=${state}`;

        logger.info('Outlook OAuth initiated', {
            userId,
            frontendUrl,
            hasClientId: !!clientId,
            redirectUri,
            state
        });

        res.json({
            success: true,
            authUrl: authUrl,
            state: state,
            message: 'Outlook OAuth flow initiated'
        });
    } catch (error: any) {
        logger.error('Outlook OAuth initiation error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to start Outlook OAuth flow'
        });
    }
};

export const handleOutlookCallback = async (req: Request, res: Response) => {
    try {
        const { code, state, error } = req.query;

        if (error) {
            logger.error('Outlook OAuth error:', error);
            const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
            return res.redirect(`${frontendUrl}/auth/error?reason=${encodeURIComponent(error as string)}`);
        }

        if (!code) {
            return res.status(400).json({
                success: false,
                error: 'Authorization code is required'
            });
        }

        const clientId = config.MICROSOFT_CLIENT_ID || process.env.MICROSOFT_CLIENT_ID;
        const clientSecret = config.MICROSOFT_CLIENT_SECRET || process.env.MICROSOFT_CLIENT_SECRET;
        const redirectUri = config.MICROSOFT_REDIRECT_URI || process.env.MICROSOFT_REDIRECT_URI ||
            `${process.env.INTEGRATIONS_URL || 'http://localhost:3001'}/api/v1/integrations/outlook/callback`;

        if (!clientId || !clientSecret) {
            logger.warn('Microsoft credentials not configured, returning sandbox mock response');
            return res.json({
                success: true,
                message: 'Outlook connected successfully (sandbox mode)',
                sandbox: true,
                data: {
                    email: 'user@outlook.com',
                    accessToken: 'mock-outlook-token'
                }
            });
        }

        logger.info('Exchanging Outlook authorization code for tokens');

        // Exchange authorization code for tokens
        const params = new URLSearchParams();
        params.append('grant_type', 'authorization_code');
        params.append('code', code as string);
        params.append('client_id', clientId);
        params.append('client_secret', clientSecret);
        params.append('redirect_uri', redirectUri);

        const tokenResponse = await axios.post(MICROSOFT_TOKEN_URL, params.toString(), {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            timeout: 30000
        });

        const { access_token, refresh_token, expires_in } = tokenResponse.data;

        logger.info('Successfully exchanged Outlook code for tokens', {
            hasAccessToken: !!access_token,
            hasRefreshToken: !!refresh_token,
            expiresIn: expires_in
        });

        // Get user's email address from Microsoft Graph API
        let userEmail = 'user@outlook.com';
        try {
            const profileResponse = await axios.get(`${GRAPH_API_URL}/me`, {
                headers: {
                    'Authorization': `Bearer ${access_token}`
                },
                timeout: 10000
            });
            userEmail = profileResponse.data.mail || profileResponse.data.userPrincipalName || userEmail;
        } catch (error: any) {
            logger.warn('Failed to fetch Outlook profile:', error.message);
        }

        // Get user ID and frontend URL from state store
        let userId: string | null = null;
        let frontendUrl: string | null = null;

        if (typeof state === 'string') {
            const stateData = await oauthStateStore.get(state);
            if (stateData) {
                userId = stateData.userId || null;
                frontendUrl = stateData.frontendUrl || null;
                await oauthStateStore.removeState(state);
            }
        }

        if (!userId) {
            logger.error('Invalid or expired OAuth state', { state });
            const defaultFrontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
            return res.redirect(`${defaultFrontendUrl}/auth/error?reason=${encodeURIComponent('invalid_state')}`);
        }

        // Store tokens in token manager
        try {
            await tokenManager.saveToken(userId, 'outlook', {
                accessToken: access_token,
                refreshToken: refresh_token || '',
                expiresAt: new Date(Date.now() + (expires_in * 1000))
            });
            logger.info('Outlook tokens saved', { userId, email: userEmail });
        } catch (error) {
            logger.error('Failed to save Outlook tokens:', error);
            const defaultFrontendUrl = frontendUrl || process.env.FRONTEND_URL || 'http://localhost:3000';
            return res.redirect(`${defaultFrontendUrl}/auth/error?reason=${encodeURIComponent('token_save_failed')}`);
        }

        // Redirect to frontend
        const redirectFrontendUrl = frontendUrl || process.env.FRONTEND_URL || 'http://localhost:3000';
        const cleanBase = redirectFrontendUrl.endsWith('/') ? redirectFrontendUrl.slice(0, -1) : redirectFrontendUrl;
        const successPath = '/auth/success';

        try {
            const url = new URL(successPath, cleanBase);
            url.searchParams.append('status', 'ok');
            url.searchParams.append('provider', 'outlook');
            url.searchParams.append('email', userEmail);
            url.searchParams.append('auth_bridge', 'true');
            url.searchParams.append('outlook_connected', 'true');

            const finalUrl = url.toString();
            logger.info('Redirecting to success page after Outlook OAuth', { finalUrl });
            return res.redirect(302, finalUrl);
        } catch (err) {
            // Fallback redirect
            const redirectUrl = `${cleanBase}${successPath}?status=ok&provider=outlook&outlook_connected=true&email=${encodeURIComponent(userEmail)}&auth_bridge=true`;
            return res.redirect(302, redirectUrl);
        }
    } catch (error: any) {
        logger.error('Outlook OAuth callback error:', {
            error: error.message,
            status: error.response?.status,
            data: error.response?.data
        });

        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
        const cleanBase = frontendUrl.endsWith('/') ? frontendUrl.slice(0, -1) : frontendUrl;
        const successPath = '/auth/success';

        try {
            const url = new URL(successPath, cleanBase);
            url.searchParams.append('status', 'error');
            url.searchParams.append('error', error.response?.data?.error_description || error.message || 'outlook_oauth_failed');
            url.searchParams.append('auth_bridge', 'true');
            url.searchParams.append('provider', 'outlook');

            return res.redirect(302, url.toString());
        } catch (err) {
            const errorUrl = `${cleanBase}${successPath}?status=error&error=${encodeURIComponent('outlook_oauth_failed')}&provider=outlook&auth_bridge=true`;
            res.redirect(302, errorUrl);
        }
    }
};

export const getOutlookStatus = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).userId || (req as any).user?.id || (req as any).user?.user_id;

        if (!userId) {
            return res.status(401).json({
                success: false,
                error: 'Authentication required'
            });
        }

        // Check if Outlook is connected
        let tokenData;
        try {
            tokenData = await tokenManager.getToken(userId, 'outlook');
        } catch (error) {
            logger.warn('Error getting Outlook token:', error);
            tokenData = null;
        }

        const isConnected = !!tokenData && !!tokenData.accessToken;
        let email: string | undefined;
        let lastSync: string | undefined;

        if (isConnected && tokenData.accessToken) {
            try {
                const profileResponse = await axios.get(`${GRAPH_API_URL}/me`, {
                    headers: {
                        'Authorization': `Bearer ${tokenData.accessToken}`
                    },
                    timeout: 5000
                });
                email = profileResponse.data.mail || profileResponse.data.userPrincipalName;

                // Get last sync time
                try {
                    const { supabase } = await import('../database/supabaseClient');
                    const { data: source } = await supabase
                        .from('evidence_sources')
                        .select('last_sync_at')
                        .eq('user_id', userId)
                        .eq('provider', 'outlook')
                        .eq('status', 'connected')
                        .maybeSingle();

                    if (source?.last_sync_at) {
                        lastSync = source.last_sync_at;
                    }
                } catch (dbError) {
                    logger.debug('Could not fetch last sync time', { error: dbError });
                }
            } catch (error: any) {
                if (error.response?.status === 401) {
                    logger.warn('Outlook token expired or invalid');
                    return res.json({
                        connected: false,
                        email: undefined,
                        lastSync: undefined,
                        message: 'Outlook token expired. Please reconnect.'
                    });
                }
                logger.warn('Failed to verify Outlook token:', error.message);
            }
        }

        res.json({
            connected: isConnected && !!email,
            email: email,
            lastSync: lastSync
        });
    } catch (error) {
        logger.error('Outlook status error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get Outlook status'
        });
    }
};

export const getOutlookEmails = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.id || 'default-user';

        const tokenData = await tokenManager.getToken(userId, 'outlook');

        if (!tokenData || !tokenData.accessToken) {
            return res.status(401).json({
                success: false,
                error: 'Outlook not connected. Please connect your Outlook account first.'
            });
        }

        // Fetch emails from Microsoft Graph API
        const response = await axios.get(`${GRAPH_API_URL}/me/messages`, {
            headers: {
                'Authorization': `Bearer ${tokenData.accessToken}`
            },
            params: {
                '$top': 20,
                '$select': 'id,subject,from,receivedDateTime,hasAttachments,bodyPreview'
            },
            timeout: 30000
        });

        const messages = response.data.value || [];

        const emails = messages.map((msg: any) => ({
            id: msg.id,
            subject: msg.subject,
            from: msg.from?.emailAddress?.address || '',
            date: msg.receivedDateTime,
            snippet: msg.bodyPreview || '',
            hasAttachments: msg.hasAttachments
        }));

        res.json({
            success: true,
            emails: emails
        });
    } catch (error: any) {
        logger.error('Outlook emails error:', error);

        if (error.response?.status === 401) {
            logger.warn('Outlook token expired, returning mock data');
            return res.json({
                success: true,
                emails: [
                    {
                        id: '1',
                        subject: 'Amazon Order Confirmation - Order #123-4567890-1234567',
                        from: 'order-update@amazon.com',
                        date: '2024-01-15T10:30:00Z',
                        hasAttachments: true
                    }
                ]
            });
        }

        res.status(500).json({
            success: false,
            error: 'Failed to fetch emails'
        });
    }
};

export const disconnectOutlook = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).userId || (req as any).user?.id;

        if (!userId) {
            return res.status(401).json({
                success: false,
                error: 'Authentication required'
            });
        }

        try {
            await tokenManager.revokeToken(userId, 'outlook');
            logger.info('Outlook token revoked', { userId });
        } catch (error) {
            logger.warn('Failed to revoke Outlook token:', error);
        }

        try {
            const { supabase } = await import('../database/supabaseClient');
            await supabase
                .from('evidence_sources')
                .update({ status: 'disconnected', updated_at: new Date().toISOString() })
                .eq('user_id', userId)
                .eq('provider', 'outlook');
        } catch (dbError) {
            logger.warn('Failed to update evidence_sources status', { error: dbError });
        }

        logger.info('Outlook disconnected', { userId });

        res.json({
            success: true,
            message: 'Outlook disconnected successfully'
        });
    } catch (error) {
        logger.error('Outlook disconnect error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to disconnect Outlook'
        });
    }
};
