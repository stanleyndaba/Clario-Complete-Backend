import { Router, Request, Response } from 'express';
import { authenticateToken, validateToken, generateToken } from '../middleware/authMiddleware';
import { db } from '../../utils/db';
import { EncryptionService } from '../../services/encryptionService';
import { AmazonOAuthService } from '../../services/amazonOAuthService';

const router = Router();

// GET /api/v1/auth/amazon - Initiate OAuth flow
router.get('/amazon', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const clientId = process.env.AMAZON_OAUTH_CLIENT_ID;
    const redirectUri = process.env.AMAZON_OAUTH_REDIRECT_URI || '';
    const authUrl = process.env.AMAZON_OAUTH_AUTH_URL || 'https://www.amazon.com/ap/oa';
    const scopes = (process.env.AMAZON_OAUTH_SCOPES || 'profile')
      .split(',')
      .map((s: string) => s.trim())
      .join(' ');

    if (!clientId || !redirectUri) {
      res.status(500).json({ error: 'OAuth not configured', message: 'Missing AMAZON_OAUTH_CLIENT_ID or AMAZON_OAUTH_REDIRECT_URI' });
      return;
    }

    // Use JWT as state to carry user context securely
    const stateToken = generateToken({ id: req.user.id, email: req.user.email, role: req.user.role });

    const url = `${authUrl}?client_id=${encodeURIComponent(clientId)}&scope=${encodeURIComponent(scopes)}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(stateToken)}`;
    res.status(302).redirect(url);
  } catch (error) {
    res.status(500).json({ error: 'Failed to initiate OAuth' });
  }
});

// GET /api/v1/auth/amazon/callback - Handle OAuth callback
router.get('/amazon/callback', async (req: Request, res: Response) => {
  try {
    const code = (req.query.code as string) || '';
    const state = (req.query.state as string) || '';

    if (!code || !state) {
      res.status(400).json({ error: 'Invalid callback parameters' });
      return;
    }

    const decoded = validateToken(state);
    if (!decoded) {
      res.status(400).json({ error: 'Invalid state' });
      return;
    }

    const redirectUri = process.env.AMAZON_OAUTH_REDIRECT_URI || '';
    const tokens = await AmazonOAuthService.exchangeCodeForTokens(code, redirectUri);

    if (!tokens.refresh_token) {
      res.status(502).json({ error: 'No refresh token returned from provider' });
      return;
    }

    // Store encrypted refresh token for the user
    const userId = decoded.id;
    const encryptedRefresh = EncryptionService.encrypt(tokens.refresh_token);

    await db.query(
      `INSERT INTO amazon_tokens (user_id, refresh_token)
       VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET refresh_token = EXCLUDED.refresh_token, updated_at = NOW()`,
      [userId, encryptedRefresh],
      userId
    );

    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'OAuth callback failed' });
  }
});

// GET /api/v1/auth/amazon/status - Check connection status
router.get('/amazon/status', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const result = await db.query('SELECT id, created_at, updated_at FROM amazon_tokens WHERE user_id = $1', [req.user.id], req.user.id);
    const connected = result.rows.length > 0;
    res.status(200).json({ connected, details: connected ? result.rows[0] : null });
  } catch (error) {
    res.status(500).json({ error: 'Failed to check status' });
  }
});

export default router;

