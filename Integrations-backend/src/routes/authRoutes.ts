import { Router } from 'express';

const router = Router();

router.get('/user', async (req, res) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      res.status(401).json({
        success: false,
        message: 'Access token required'
      });
      return;
    }

    // Mock user data for now
    res.json({
      success: true,
      user: {
        id: 'user-123',
        email: 'user@example.com',
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
    res.clearCookie('session', { path: '/', sameSite: 'none', secure: true });
    res.json({ ok: true });
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
