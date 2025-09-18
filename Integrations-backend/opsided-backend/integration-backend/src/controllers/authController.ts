import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { User } from '../../../shared/models/User';
import { hashPassword, verifyPassword, generateSecureToken } from '../../../shared/utils/encryption';
import { getLogger } from '../../../shared/utils/logger';
import { ApiResponse, AuthResponse } from '../../../shared/types/api';
import { queueManager } from '../jobs/queueManager';

const logger = getLogger('AuthController');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({
        success: false,
        message: 'Email and password are required',
        timestamp: new Date().toISOString(),
      } as ApiResponse);
      return;
    }

    // Find user by email
    const user = await User.findByEmail(email);
    if (!user) {
      res.status(401).json({
        success: false,
        message: 'Invalid credentials',
        timestamp: new Date().toISOString(),
      } as ApiResponse);
      return;
    }

    // TODO: Implement password verification
    // For now, we'll use a stub implementation
    const isValidPassword = await verifyPassword(password, 'stub-hashed-password');
    if (!isValidPassword) {
      res.status(401).json({
        success: false,
        message: 'Invalid credentials',
        timestamp: new Date().toISOString(),
      } as ApiResponse);
      return;
    }

    // Generate JWT token
    const token = jwt.sign(
      { 
        id: user.id, 
        email: user.email, 
        role: user.role 
      },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    // Generate refresh token
    const refreshToken = generateSecureToken();

    const response: AuthResponse = {
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
      },
      token,
      refreshToken,
      expiresIn: 24 * 60 * 60, // 24 hours in seconds
    };

    logger.info(`User ${user.email} logged in successfully`);

    res.status(200).json({
      success: true,
      message: 'Login successful',
      data: response,
      timestamp: new Date().toISOString(),
    } as ApiResponse<AuthResponse>);

  } catch (error) {
    logger.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: 'Login failed',
      timestamp: new Date().toISOString(),
    } as ApiResponse);
  }
};

export const logout = async (req: Request, res: Response): Promise<void> => {
  try {
    // TODO: Implement token blacklisting or invalidation
    // For now, we'll just return a success response
    
    logger.info('User logged out successfully');

    res.status(200).json({
      success: true,
      message: 'Logout successful',
      timestamp: new Date().toISOString(),
    } as ApiResponse);

  } catch (error) {
    logger.error('Logout error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: 'Logout failed',
      timestamp: new Date().toISOString(),
    } as ApiResponse);
  }
};

export const refreshToken = async (req: Request, res: Response): Promise<void> => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      res.status(400).json({
        success: false,
        message: 'Refresh token is required',
        timestamp: new Date().toISOString(),
      } as ApiResponse);
      return;
    }

    // TODO: Implement refresh token validation
    // For now, we'll use a stub implementation
    const isValidRefreshToken = refreshToken === 'valid-refresh-token';
    if (!isValidRefreshToken) {
      res.status(401).json({
        success: false,
        message: 'Invalid refresh token',
        timestamp: new Date().toISOString(),
      } as ApiResponse);
      return;
    }

    // Generate new access token
    const newToken = jwt.sign(
      { 
        id: 'user-id', 
        email: 'user@example.com', 
        role: 'user' 
      },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    const response: AuthResponse = {
      user: {
        id: 'user-id',
        email: 'user@example.com',
        role: 'user',
      },
      token: newToken,
      refreshToken: generateSecureToken(),
      expiresIn: 24 * 60 * 60,
    };

    logger.info('Token refreshed successfully');

    res.status(200).json({
      success: true,
      message: 'Token refreshed successfully',
      data: response,
      timestamp: new Date().toISOString(),
    } as ApiResponse<AuthResponse>);

  } catch (error) {
    logger.error('Token refresh error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: 'Token refresh failed',
      timestamp: new Date().toISOString(),
    } as ApiResponse);
  }
};

// Amazon OAuth callback - triggers full historical sync
export const amazonOAuthCallback = async (req: Request, res: Response): Promise<void> => {
  try {
    const { code, state } = req.query;
    const userId = req.user?.id; // Assuming user is authenticated

    if (!code || !userId) {
      res.status(400).json({
        success: false,
        message: 'Authorization code and user ID are required',
        timestamp: new Date().toISOString(),
      } as ApiResponse);
      return;
    }

    logger.info(`Amazon OAuth callback received for user ${userId}`);

    // TODO: Exchange code for tokens and store them
    // This would use the amazonService.exchangeCodeForToken method

    // Trigger full historical sync job
    try {
      const job = await queueManager.addFullHistoricalSync(userId, 1); // High priority
      
      logger.info(`Full historical sync job triggered for user ${userId}, job ID: ${job.id}`);

      res.status(200).json({
        success: true,
        message: 'Amazon OAuth successful, historical sync started',
        data: {
          jobId: job.id,
          status: 'queued',
          message: 'Your historical data sync has been started. You will receive updates as it progresses.',
        },
        timestamp: new Date().toISOString(),
      } as ApiResponse);

    } catch (jobError) {
      logger.error(`Error triggering historical sync for user ${userId}:`, jobError);
      
      // Still return success for OAuth, but note the sync issue
      res.status(200).json({
        success: true,
        message: 'Amazon OAuth successful, but historical sync failed to start',
        data: {
          status: 'oauth_success_sync_failed',
          message: 'Your Amazon account is connected, but we encountered an issue starting the data sync. Please try again later.',
        },
        timestamp: new Date().toISOString(),
      } as ApiResponse);
    }

  } catch (error) {
    logger.error('Amazon OAuth callback error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: 'Amazon OAuth callback failed',
      timestamp: new Date().toISOString(),
    } as ApiResponse);
  }
}; 