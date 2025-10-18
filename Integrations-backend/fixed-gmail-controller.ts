import { Request, Response } from 'express';
import gmailService from '../services/gmailService';

export const getGmailStatus = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id; // From auth middleware
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }

    const isConnected = await gmailService.isTokenValid(userId);
    
    res.json({
      success: true,
      connected: isConnected,
      email: isConnected ? 'user@example.com' : undefined // Would get from Gmail API
    });
  } catch (error) {
    console.error('Gmail status error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get Gmail status'
    });
  }
};

export const connectGmail = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }

    const result = await gmailService.connectGmail(userId);
    
    res.json({
      success: true,
      message: 'Gmail connection initiated',
      authUrl: result.authUrl
    });
  } catch (error) {
    console.error('Gmail connection error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to connect Gmail'
    });
  }
};

export const getGmailEmails = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }

    const emails = await gmailService.fetchEmails(userId);
    
    res.json({
      success: true,
      emails: emails
    });
  } catch (error) {
    console.error('Gmail emails error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch emails'
    });
  }
};
