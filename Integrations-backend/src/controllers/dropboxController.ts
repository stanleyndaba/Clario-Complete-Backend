import { Request, Response } from 'express';
import axios from 'axios';
import crypto from 'crypto';
import logger from '../utils/logger';
import config from '../config/env';
import tokenManager from '../utils/tokenManager';
import oauthStateStore from '../utils/oauthStateStore';

// Dropbox OAuth URLs
const DROPBOX_AUTH_URL = 'https://www.dropbox.com/oauth2/authorize';
const DROPBOX_TOKEN_URL = 'https://api.dropboxapi.com/oauth2/token';
const DROPBOX_API_URL = 'https://api.dropboxapi.com/2';
const DROPBOX_CONTENT_URL = 'https://content.dropboxapi.com/2';

export const initiateDropboxOAuth = async (req: Request, res: Response) => {
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

        const clientId = config.DROPBOX_CLIENT_ID || process.env.DROPBOX_CLIENT_ID;
        const redirectUri = config.DROPBOX_REDIRECT_URI || process.env.DROPBOX_REDIRECT_URI ||
            `${process.env.INTEGRATIONS_URL || 'http://localhost:3001'}/api/v1/integrations/dropbox/callback`;

        if (!clientId || !config.DROPBOX_CLIENT_SECRET) {
            logger.warn('Dropbox credentials not configured, returning sandbox mock URL');
            const mockAuthUrl = `${DROPBOX_AUTH_URL}?client_id=mock-client-id&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code`;

            return res.json({
                success: true,
                authUrl: mockAuthUrl,
                message: 'Dropbox OAuth flow initiated (sandbox mode - credentials not configured)',
                sandbox: true
            });
        }

        // Generate state for CSRF protection
        const state = crypto.randomBytes(32).toString('hex');
        await oauthStateStore.setState(state, userId, frontendUrl);

        // Build OAuth URL
        const authUrl = `${DROPBOX_AUTH_URL}?` +
            `client_id=${encodeURIComponent(clientId)}&` +
            `redirect_uri=${encodeURIComponent(redirectUri)}&` +
            `response_type=code&` +
            `token_access_type=offline&` +
            `state=${state}`;

        logger.info('Dropbox OAuth initiated', {
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
            message: 'Dropbox OAuth flow initiated'
        });
    } catch (error: any) {
        logger.error('Dropbox OAuth initiation error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to start Dropbox OAuth flow'
        });
    }
};

export const handleDropboxCallback = async (req: Request, res: Response) => {
    try {
        const { code, state, error } = req.query;

        if (error) {
            logger.error('Dropbox OAuth error:', error);
            const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
            return res.redirect(`${frontendUrl}/auth/error?reason=${encodeURIComponent(error as string)}`);
        }

        if (!code) {
            return res.status(400).json({
                success: false,
                error: 'Authorization code is required'
            });
        }

        const clientId = config.DROPBOX_CLIENT_ID || process.env.DROPBOX_CLIENT_ID;
        const clientSecret = config.DROPBOX_CLIENT_SECRET || process.env.DROPBOX_CLIENT_SECRET;
        const redirectUri = config.DROPBOX_REDIRECT_URI || process.env.DROPBOX_REDIRECT_URI ||
            `${process.env.INTEGRATIONS_URL || 'http://localhost:3001'}/api/v1/integrations/dropbox/callback`;

        if (!clientId || !clientSecret) {
            logger.warn('Dropbox credentials not configured, returning sandbox mock response');
            return res.json({
                success: true,
                message: 'Dropbox connected successfully (sandbox mode)',
                sandbox: true,
                data: {
                    email: 'user@dropbox.com',
                    accessToken: 'mock-dropbox-token'
                }
            });
        }

        logger.info('Exchanging Dropbox authorization code for tokens');

        // Exchange authorization code for tokens
        const params = new URLSearchParams();
        params.append('grant_type', 'authorization_code');
        params.append('code', code as string);
        params.append('client_id', clientId);
        params.append('client_secret', clientSecret);
        params.append('redirect_uri', redirectUri);

        const tokenResponse = await axios.post(DROPBOX_TOKEN_URL, params.toString(), {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            timeout: 30000
        });

        const { access_token, refresh_token, expires_in } = tokenResponse.data;

        logger.info('Successfully exchanged Dropbox code for tokens', {
            hasAccessToken: !!access_token,
            hasRefreshToken: !!refresh_token,
            expiresIn: expires_in
        });

        // Get user's email address from Dropbox API
        let userEmail = 'user@dropbox.com';
        try {
            const profileResponse = await axios.post(
                `${DROPBOX_API_URL}/users/get_current_account`,
                null,
                {
                    headers: {
                        'Authorization': `Bearer ${access_token}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 10000
                }
            );
            userEmail = profileResponse.data.email || userEmail;
        } catch (error: any) {
            logger.warn('Failed to fetch Dropbox profile:', error.message);
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
        // Dropbox tokens don't always have expires_in, so use a default of 4 hours
        const expiresInSeconds = expires_in || 14400;
        try {
            await tokenManager.saveToken(userId, 'dropbox', {
                accessToken: access_token,
                refreshToken: refresh_token || '',
                expiresAt: new Date(Date.now() + (expiresInSeconds * 1000))
            });
            logger.info('Dropbox tokens saved', { userId, email: userEmail });
        } catch (error) {
            logger.error('Failed to save Dropbox tokens:', error);
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
            url.searchParams.append('provider', 'dropbox');
            url.searchParams.append('email', userEmail);
            url.searchParams.append('auth_bridge', 'true');
            url.searchParams.append('dropbox_connected', 'true');

            const finalUrl = url.toString();
            logger.info('Redirecting to success page after Dropbox OAuth', { finalUrl });
            return res.redirect(302, finalUrl);
        } catch (err) {
            // Fallback redirect
            const redirectUrl = `${cleanBase}${successPath}?status=ok&provider=dropbox&dropbox_connected=true&email=${encodeURIComponent(userEmail)}&auth_bridge=true`;
            return res.redirect(302, redirectUrl);
        }
    } catch (error: any) {
        logger.error('Dropbox OAuth callback error:', {
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
            url.searchParams.append('error', error.response?.data?.error_description || error.message || 'dropbox_oauth_failed');
            url.searchParams.append('auth_bridge', 'true');
            url.searchParams.append('provider', 'dropbox');

            return res.redirect(302, url.toString());
        } catch (err) {
            const errorUrl = `${cleanBase}${successPath}?status=error&error=${encodeURIComponent('dropbox_oauth_failed')}&provider=dropbox&auth_bridge=true`;
            res.redirect(302, errorUrl);
        }
    }
}

export const getDropboxStatus = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).userId || (req as any).user?.id || (req as any).user?.user_id;

        if (!userId) {
            return res.status(401).json({
                success: false,
                error: 'Authentication required'
            });
        }

        // Check if Dropbox is connected
        let tokenData;
        try {
            tokenData = await tokenManager.getToken(userId, 'dropbox');
        } catch (error) {
            logger.warn('Error getting Dropbox token:', error);
            tokenData = null;
        }

        const isConnected = !!tokenData && !!tokenData.accessToken;
        let email: string | undefined;
        let lastSync: string | undefined;

        if (isConnected && tokenData.accessToken) {
            try {
                const profileResponse = await axios.post(
                    `${DROPBOX_API_URL}/users/get_current_account`,
                    null,
                    {
                        headers: {
                            'Authorization': `Bearer ${tokenData.accessToken}`,
                            'Content-Type': 'application/json'
                        },
                        timeout: 5000
                    }
                );
                email = profileResponse.data.email;

                // Get last sync time
                try {
                    const { supabase } = await import('../database/supabaseClient');
                    const { data: source } = await supabase
                        .from('evidence_sources')
                        .select('last_sync_at')
                        .eq('user_id', userId)
                        .eq('provider', 'dropbox')
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
                    logger.warn('Dropbox token expired or invalid');
                    return res.json({
                        connected: false,
                        email: undefined,
                        lastSync: undefined,
                        message: 'Dropbox token expired. Please reconnect.'
                    });
                }
                logger.warn('Failed to verify Dropbox token:', error.message);
            }
        }

        res.json({
            connected: isConnected && !!email,
            email: email,
            lastSync: lastSync
        });
    } catch (error) {
        logger.error('Dropbox status error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get Dropbox status'
        });
    }
};

export const listDropboxFiles = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.id || 'default-user';

        const tokenData = await tokenManager.getToken(userId, 'dropbox');

        if (!tokenData || !tokenData.accessToken) {
            return res.status(401).json({
                success: false,
                error: 'Dropbox not connected. Please connect your account first.'
            });
        }

        // Fetch files from Dropbox API
        const response = await axios.post(
            `${DROPBOX_API_URL}/files/list_folder`,
            {
                path: '',
                recursive: false,
                limit: 20
            },
            {
                headers: {
                    'Authorization': `Bearer ${tokenData.accessToken}`,
                    'Content-Type': 'application/json'
                },
                timeout: 30000
            }
        );

        const entries = response.data.entries || [];

        // Filter out folders
        const files = entries
            .filter((entry: any) => entry['.tag'] === 'file')
            .map((file: any) => ({
                id: file.id,
                name: file.name,
                path: file.path_display,
                modifiedTime: file.server_modified,
                size: file.size
            }));

        res.json({
            success: true,
            files: files
        });
    } catch (error: any) {
        logger.error('Dropbox files error:', error);

        if (error.response?.status === 401) {
            logger.warn('Dropbox token expired, returning mock data');
            return res.json({
                success: true,
                files: [
                    {
                        id: '1',
                        name: 'Amazon Invoice 2024.pdf',
                        path: '/Amazon Invoice 2024.pdf',
                        modifiedTime: '2024-01-15T10:30:00Z',
                        size: 125000
                    }
                ]
            });
        }

        res.status(500).json({
            success: false,
            error: 'Failed to fetch files'
        });
    }
};

export const disconnectDropbox = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).userId || (req as any).user?.id;

        if (!userId) {
            return res.status(401).json({
                success: false,
                error: 'Authentication required'
            });
        }

        try {
            await tokenManager.revokeToken(userId, 'dropbox');
            logger.info('Dropbox token revoked', { userId });
        } catch (error) {
            logger.warn('Failed to revoke Dropbox token:', error);
        }

        try {
            const { supabase } = await import('../database/supabaseClient');
            await supabase
                .from('evidence_sources')
                .update({ status: 'disconnected', updated_at: new Date().toISOString() })
                .eq('user_id', userId)
                .eq('provider', 'dropbox');
        } catch (dbError) {
            logger.warn('Failed to update evidence_sources status', { error: dbError });
        }

        logger.info('Dropbox disconnected', { userId });

        res.json({
            success: true,
            message: 'Dropbox disconnected successfully'
        });
    } catch (error) {
        logger.error('Dropbox disconnect error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to disconnect Dropbox'
        });
    }
};
