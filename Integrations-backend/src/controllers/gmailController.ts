import { Request, Response } from 'express';

export const initiateGmailOAuth = async (_req: Request, res: Response) => {
  try {
    // Mock Gmail OAuth URL
    const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?client_id=mock-client-id&redirect_uri=http://localhost:3001/api/v1/integrations/gmail/callback&response_type=code&scope=https://www.googleapis.com/auth/gmail.readonly';
    
    res.json({
      success: true,
      authUrl: authUrl,
      message: 'Gmail OAuth flow initiated'
    });
  } catch (error) {
    console.error('Gmail OAuth initiation error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to start Gmail OAuth flow'
    });
  }
};

export const handleGmailCallback = async (req: Request, res: Response) => {
  try {
    const { code } = req.query;

    if (!code) {
      res.status(400).json({
        success: false,
        error: 'Authorization code is required'
      });
      return;
    }

    // Mock successful Gmail connection
    res.json({
      success: true,
      message: 'Gmail connected successfully',
      data: {
        email: 'user@example.com',
        accessToken: 'mock-gmail-token'
      }
    });
  } catch (error) {
    console.error('Gmail OAuth callback error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to complete Gmail OAuth flow'
    });
  }
};

export const connectGmail = async (_req: Request, res: Response) => {
  try {
    // Mock Gmail connection
    res.json({
      success: true,
      message: 'Gmail connected successfully',
      data: {
        email: 'user@example.com',
        inboxCount: 1250
      }
    });
  } catch (error) {
    console.error('Gmail connection error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to connect Gmail'
    });
  }
};

export const getGmailEmails = async (_req: Request, res: Response) => {
  try {
    // Mock email data for evidence
    res.json({
      success: true,
      emails: [
        {
          id: '1',
          subject: 'Amazon Order Confirmation - Order #123-4567890-1234567',
          from: 'order-update@amazon.com',
          date: '2024-01-15T10:30:00Z',
          hasAttachments: true
        },
        {
          id: '2', 
          subject: 'Invoice for Order #123-4567890-1234567',
          from: 'invoices@supplier.com',
          date: '2024-01-15T11:15:00Z',
          hasAttachments: true
        }
      ]
    });
  } catch (error) {
    console.error('Gmail emails error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch emails'
    });
  }
};

export const searchGmailEmails = async (req: Request, res: Response) => {
  try {
    const { query } = req.query;
    
    // Mock search results
    res.json({
      success: true,
      query: query,
      results: [
        {
          id: '3',
          subject: 'Shipping Confirmation - Order #123-4567890-1234567',
          from: 'shipment-tracking@amazon.com',
          date: '2024-01-16T08:45:00Z',
          snippet: 'Your order has been shipped...'
        }
      ]
    });
  } catch (error) {
    console.error('Gmail search error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to search emails'
    });
  }
};

export const disconnectGmail = async (_req: Request, res: Response) => {
  try {
    res.json({
      success: true,
      message: 'Gmail disconnected successfully'
    });
  } catch (error) {
    console.error('Gmail disconnect error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to disconnect Gmail'
    });
  }
};
