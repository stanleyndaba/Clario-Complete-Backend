import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import config from '../config/env';

const router = Router();

// Helper to extract JWT from cookie or Authorization header
function extractToken(req: Request): string | null {
  // Priority 1: Check cookie (session_token)
  const cookieToken = req.cookies?.session_token;
  if (cookieToken) return cookieToken;
  
  // Priority 2: Check Authorization header
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.split(' ')[1];
  }
  
  return null;
}

// Helper to verify and decode JWT
function verifyToken(token: string): any {
  try {
    return jwt.verify(token, config.JWT_SECRET);
  } catch (error) {
    return null;
  }
}

router.get('/me', async (req, res) => {
  try {
    const token = extractToken(req);
    
    if (!token) {
      res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
      return;
    }

    const decoded = verifyToken(token);
    if (!decoded) {
      res.status(401).json({
        success: false,
        message: 'Invalid or expired token'
      });
      return;
    }

    // Extract user_id from token (could be user_id or userId)
    const user_id = decoded.user_id || decoded.userId || decoded.id;
    
    if (!user_id) {
      res.status(401).json({
        success: false,
        message: 'Invalid token payload'
      });
      return;
    }

    // For now, return basic user info from token
    // TODO: Fetch full user data from database if needed
    res.json({
      id: user_id,
      email: decoded.email || 'user@example.com',
      name: decoded.name || decoded.company_name || 'User',
      amazon_connected: !!decoded.amazon_seller_id,
      stripe_connected: !!decoded.stripe_customer_id,
      created_at: decoded.created_at || new Date().toISOString(),
      last_login: decoded.last_login || new Date().toISOString()
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
    const token = extractToken(req);

    if (!token) {
      res.status(401).json({
        success: false,
        message: 'Access token required'
      });
      return;
    }

    const decoded = verifyToken(token);
    if (!decoded) {
      res.status(401).json({
        success: false,
        message: 'Invalid or expired token'
      });
      return;
    }

    // Mock user data for now
    res.json({
      success: true,
      user: {
        id: decoded.user_id || decoded.userId || decoded.id || 'user-123',
        email: decoded.email || 'user@example.com',
        name: decoded.name || 'Test User'
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
    // Mock profile data
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
    
    // Mock profile update
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
    // Clear both possible cookie names
    res.clearCookie('session_token', { path: '/', sameSite: 'none', secure: true, httpOnly: true });
    res.clearCookie('session', { path: '/', sameSite: 'none', secure: true });
    res.json({ ok: true, message: 'Logged out successfully' });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error?.message || 'Internal server error' });
  }
});

router.get('/billing', async (_req, res) => {
  try {
    // Mock billing data
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
