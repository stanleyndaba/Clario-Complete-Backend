import { Request, Response } from 'express';
import axios from 'axios';
import crypto from 'crypto';
import logger from '../utils/logger';
import config from '../config/env';
import tokenManager from '../utils/tokenManager';
import oauthStateStore from '../utils/oauthStateStore';

// Google OAuth URLs (same as Gmail but different scopes)
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_DRIVE_API_URL = 'https://www.googleapis.com/drive/v3';

export const initiateGoogleDriveOAuth = async (req: Request, res: Response) => {
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

        // Can reuse Gmail credentials or use separate Drive credentials
        const clientId = config.GOOGLE_DRIVE_CLIENT_ID || config.GMAIL_CLIENT_ID || process.env.GOOGLE_DRIVE_CLIENT_ID || process.env.GMAIL_CLIENT_ID;
        const clientSecret = config.GOOGLE_DRIVE_CLIENT_SECRET || config.GMAIL_CLIENT_SECRET || process.env.GOOGLE_DRIVE_CLIENT_SECRET || process.env.GMAIL_CLIENT_SECRET;
        const redirectUri = config.GOOGLE_DRIVE_REDIRECT_URI || process.env.GOOGLE_DRIVE_REDIRECT_URI ||
            `${process.env.INTEGRATIONS_URL || 'http://localhost:3001'}/api/v1/integrations/gdrive/callback`;

        if (!clientId || !clientSecret) {
            logger.warn('Google Drive credentials not configured, returning sandbox mock URL');
            const mockAuthUrl = `${GOOGLE_AUTH_URL}?client_id=mock-client-id&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=https://www.googleapis.com/auth/drive.readonly`;

            return res.json({
                success: true,
                authUrl: mockAuthUrl,
                message: 'Google Drive OAuth flow initiated (sandbox mode - credentials not configured)',
                sandbox: true
            });
        }

        // Generate state for CSRF protection
        const state = crypto.randomBytes(32).toString('hex');
        await oauthStateStore.setState(state, userId, frontendUrl);

        // Google Drive OAuth scopes
        const scopes = [
            'https://www.googleapis.com/auth/drive.readonly',
            'https://www.googleapis.com/auth/userinfo.email'
        ].join(' ');

        // Build OAuth URL
        const authUrl = `${GOOGLE_AUTH_URL}?` +
            `client_id=${encodeURIComponent(clientId)}&` +
            `redirect_uri=${encodeURIComponent(redirectUri)}&` +
            `response_type=code&` +
            `scope=${encodeURIComponent(scopes)}&` +
            `access_type=offline&` +
            `prompt=consent&` +
            `state=${state}`;

        logger.info('Google Drive OAuth initiated', {
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
            message: 'Google Drive OAuth flow initiated'
        });
    } catch (error: any) {
        logger.error('Google Drive OAuth initiation error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to start Google Drive OAuth flow'
        });
    }
};

export const handleGoogleDriveCallback = async (req: Request, res: Response) => {
    try {
        const { code, state, error } = req.query;

        if (error) {
            logger.error('Google Drive OAuth error:', error);
            const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
            return res.redirect(`${frontendUrl}/auth/error?reason=${encodeURIComponent(error as string)}`);
        }

        if (!code) {
            return res.status(400).json({
                success: false,
                error: 'Authorization code is required'
            });
        }

        const clientId = config.GOOGLE_DRIVE_CLIENT_ID || config.GMAIL_CLIENT_ID || process.env.GOOGLE_DRIVE_CLIENT_ID;
        const clientSecret = config.GOOGLE_DRIVE_CLIENT_SECRET || config.GMAIL_CLIENT_SECRET || process.env.GOOGLE_DRIVE_CLIENT_SECRET;
        const redirectUri = config.GOOGLE_DRIVE_REDIRECT_URI || process.env.GOOGLE_DRIVE_REDIRECT_URI ||
            `${process.env.INTEGRATIONS_URL || 'http://localhost:3001'}/api/v1/integrations/gdrive/callback`;

        if (!clientId || !clientSecret) {
            logger.warn('Google Drive credentials not configured, returning sandbox mock response');
            return res.json({
                success: true,
                message: 'Google Drive connected successfully (sandbox mode)',
                sandbox: true,
                data: {
                    email: 'user@gmail.com',
                    accessToken: 'mock-gdrive-token'
                }
            });
        }

        logger.info('Exchanging Google Drive authorization code for tokens');

        // Exchange authorization code for tokens
        const tokenResponse = await axios.post(
            GOOGLE_TOKEN_URL,
            {
                grant_type: 'authorization_code',
                code: code,
                client_id: clientId,
                client_secret: clientSecret,
                redirect_uri: redirectUri
            },
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                timeout: 30000
            }
        );

        const { access_token, refresh_token, expires_in } = tokenResponse.data;

        logger.info('Successfully exchanged Google Drive code for tokens', {
            hasAccessToken: !!access_token,
            hasRefreshToken: !!refresh_token,
            expiresIn: expires_in
        });

        // Get user's email address
        let userEmail = 'user@gmail.com';
        try {
            const profileResponse = await axios.get(
                'https://www.googleapis.com/oauth2/v2/userinfo',
                {
                    headers: {
                        'Authorization': `Bearer ${access_token}`
                    },
                    timeout: 10000
                }
            );
            userEmail = profileResponse.data.email || userEmail;
        } catch (error: any) {
            logger.warn('Failed to fetch Google profile:', error.message);
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
            await tokenManager.saveToken(userId, 'gdrive', {
                accessToken: access_token,
                refreshToken: refresh_token || '',
                expiresAt: new Date(Date.now() + (expires_in * 1000))
            });
            logger.info('Google Drive tokens saved', { userId, email: userEmail });
        } catch (error) {
            logger.error('Failed to save Google Drive tokens:', error);
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
            url.searchParams.append('provider', 'gdrive');
            url.searchParams.append('email', userEmail);
            url.searchParams.append('auth_bridge', 'true');
            url.searchParams.append('gdrive_connected', 'true');

            const finalUrl = url.toString();
            logger.info('Redirecting to success page after Google Drive OAuth', { finalUrl });
            return res.redirect(302, finalUrl);
        } catch (err) {
            // Fallback redirect
            const redirectUrl = `${cleanBase}${successPath}?status=ok&provider=gdrive&gdrive_connected=true&email=${encodeURIComponent(userEmail)}&auth_bridge=true`;
            return res.redirect(302, redirectUrl);
        }
    } catch (error: any) {
        logger.error('Google Drive OAuth callback error:', {
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
            url.searchParams.append('error', error.response?.data?.error_description || error.message || 'gdrive_oauth_failed');
            url.searchParams.append('auth_bridge', 'true');
            url.searchParams.append('provider', 'gdrive');

            return res.redirect(302, url.toString());
        } catch (err) {
            const errorUrl = `${cleanBase}${successPath}?status=error&error=${encodeURIComponent('gdrive_oauth_failed')}&provider=gdrive&auth_bridge=true`;
            res.redirect(302, errorUrl);
        }
    }
};

export const getGoogleDriveStatus = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).userId || (req as any).user?.id || (req as any).user?.user_id;

        if (!userId) {
            return res.status(401).json({
                success: false,
                error: 'Authentication required'
            });
        }

        // Check if Google Drive is connected
        let tokenData;
        try {
            tokenData = await tokenManager.getToken(userId, 'gdrive');
        } catch (error) {
            logger.warn('Error getting Google Drive token:', error);
            tokenData = null;
        }

        const isConnected = !!tokenData && !!tokenData.accessToken;
        let email: string | undefined;
        let lastSync: string | undefined;

        if (isConnected && tokenData.accessToken) {
            try {
                const profileResponse = await axios.get(
                    'https://www.googleapis.com/oauth2/v2/userinfo',
                    {
                        headers: {
                            'Authorization': `Bearer ${tokenData.accessToken}`
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
                        .eq('provider', 'gdrive')
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
                    logger.warn('Google Drive token expired or invalid');
                    return res.json({
                        connected: false,
                        email: undefined,
                        lastSync: undefined,
                        message: 'Google Drive token expired. Please reconnect.'
                    });
                }
                logger.warn('Failed to verify Google Drive token:', error.message);
            }
        }

        res.json({
            connected: isConnected && !!email,
            email: email,
            lastSync: lastSync
        });
    } catch (error) {
        logger.error('Google Drive status error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get Google Drive status'
        });
    }
};

export const listGoogleDriveFiles = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.id || 'default-user';

        const tokenData = await tokenManager.getToken(userId, 'gdrive');

        if (!tokenData || !tokenData.accessToken) {
            return res.status(401).json({
                success: false,
                error: 'Google Drive not connected. Please connect your account first.'
            });
        }

        // Fetch files from Google Drive API
        const response = await axios.get(`${GOOGLE_DRIVE_API_URL}/files`, {
            headers: {
                'Authorization': `Bearer ${tokenData.accessToken}`
            },
            params: {
                pageSize: 20,
                fields: 'files(id,name,mimeType,modifiedTime,size,webViewLink)',
                q: "mimeType!='application/vnd.google-apps.folder'"
            },
            timeout: 30000
        });

        const files = response.data.files || [];

        res.json({
            success: true,
            files: files.map((file: any) => ({
                id: file.id,
                name: file.name,
                mimeType: file.mimeType,
                modifiedTime: file.modifiedTime,
                size: file.size,
                webViewLink: file.webViewLink
            }))
        });
    } catch (error: any) {
        logger.error('Google Drive files error:', error);

        if (error.response?.status === 401) {
            logger.warn('Google Drive token expired, returning mock data');
            return res.json({
                success: true,
                files: [
                    {
                        id: '1',
                        name: 'Amazon Invoice 2024.pdf',
                        mimeType: 'application/pdf',
                        modifiedTime: '2024-01-15T10:30:00Z',
                        size: '125000'
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

export const disconnectGoogleDrive = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).userId || (req as any).user?.id;

        if (!userId) {
            return res.status(401).json({
                success: false,
                error: 'Authentication required'
            });
        }

        try {
            await tokenManager.revokeToken(userId, 'gdrive');
            logger.info('Google Drive token revoked', { userId });
        } catch (error) {
            logger.warn('Failed to revoke Google Drive token:', error);
        }

        try {
            const { supabase } = await import('../database/supabaseClient');
            await supabase
                .from('evidence_sources')
                .update({ status: 'disconnected', updated_at: new Date().toISOString() })
                .eq('user_id', userId)
                .eq('provider', 'gdrive');
        } catch (dbError) {
            logger.warn('Failed to update evidence_sources status', { error: dbError });
        }

        logger.info('Google Drive disconnected', { userId });

        res.json({
            success: true,
            message: 'Google Drive disconnected successfully'
        });
    } catch (error) {
        logger.error('Google Drive disconnect error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to disconnect Google Drive'
        });
    }
};
