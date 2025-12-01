import axios from 'axios';
import config from '../config/env';
import logger from '../utils/logger';
import tokenManager from '../utils/tokenManager';
import { createError } from '../utils/errorHandler';

export interface GmailEmail {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  snippet: string;
  body: string;
  date: string;
  labels: string[];
  isRead: boolean;
  hasAttachments: boolean;
}

export interface GmailOAuthResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  scope: string;
}

export interface GmailListResponse {
  messages: Array<{ id: string; threadId: string }>;
  nextPageToken?: string;
  resultSizeEstimate: number;
}

export interface GmailMessageResponse {
  id: string;
  threadId: string;
  labelIds: string[];
  snippet: string;
  historyId: string;
  internalDate: string;
  payload: {
    partId: string;
    mimeType: string;
    filename: string;
    headers: Array<{ name: string; value: string }>;
    body: {
      data?: string;
      size?: number;
      attachmentId?: string;
    };
    parts?: any[];
  };
}

export class GmailService {
  private baseUrl = 'https://gmail.googleapis.com/gmail/v1/users/me';
  private authUrl = 'https://oauth2.googleapis.com/token';

  async initiateOAuth(userId: string): Promise<string> {
    try {
      const authUrl = new URL(config.GMAIL_AUTH_URL!);
      authUrl.searchParams.set('client_id', config.GMAIL_CLIENT_ID!);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('redirect_uri', config.GMAIL_REDIRECT_URI!);
      authUrl.searchParams.set('scope', 'https://www.googleapis.com/auth/gmail.readonly');
      authUrl.searchParams.set('access_type', 'offline');
      authUrl.searchParams.set('prompt', 'consent');
      authUrl.searchParams.set('state', userId);

      logger.info('Gmail OAuth initiated', { userId });
      return authUrl.toString();
    } catch (error) {
      logger.error('Error initiating Gmail OAuth', { error, userId });
      throw createError('Failed to initiate Gmail OAuth', 500);
    }
  }

  async handleOAuthCallback(code: string, userId: string): Promise<void> {
    try {
      logger.info('🔄 [GMAIL OAUTH] Handling callback', { userId });

      const tokenResponse = await axios.post(this.authUrl, {
        grant_type: 'authorization_code',
        code,
        client_id: config.GMAIL_CLIENT_ID!,
        client_secret: config.GMAIL_CLIENT_SECRET,
        redirect_uri: config.GMAIL_REDIRECT_URI!
      });

      const tokenData: GmailOAuthResponse = tokenResponse.data;
      const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000);

      logger.info('✅ [GMAIL OAUTH] Received token from Google', {
        userId,
        hasRefreshToken: !!tokenData.refresh_token,
        expiresIn: tokenData.expires_in
      });

      await tokenManager.saveToken(userId, 'gmail', {
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        expiresAt
      });

      logger.info('💾 [GMAIL OAUTH] Token saved to database', { userId });
    } catch (error) {
      logger.error('❌ [GMAIL OAUTH] Error handling callback', { error, userId });
      throw createError('Failed to complete Gmail OAuth', 500);
    }
  }

  async refreshAccessToken(userId: string): Promise<string> {
    try {
      const tokenStatus = await tokenManager.getTokenWithStatus(userId, 'gmail');
      const tokenData = tokenStatus?.token;

      if (!tokenData) {
        throw createError('No Gmail token found', 401);
      }

      if (!tokenData.refreshToken) {
        logger.error('No Gmail refresh token available', { userId });
        throw createError('No Gmail refresh token available', 401);
      }

      const response = await axios.post(this.authUrl, {
        grant_type: 'refresh_token',
        refresh_token: tokenData.refreshToken,
        client_id: config.GMAIL_CLIENT_ID!,
        client_secret: config.GMAIL_CLIENT_SECRET
      });

      const newTokenData: GmailOAuthResponse = response.data;
      const expiresAt = new Date(Date.now() + newTokenData.expires_in * 1000);

      await tokenManager.refreshToken(userId, 'gmail', {
        accessToken: newTokenData.access_token,
        refreshToken: newTokenData.refresh_token,
        expiresAt
      });

      logger.info('Gmail access token refreshed', { userId });
      return newTokenData.access_token;
    } catch (error) {
      logger.error('Error refreshing Gmail access token', { error, userId });
      throw createError('Failed to refresh Gmail access token', 500);
    }
  }

  async getValidAccessToken(userId: string): Promise<string> {
    try {
      const tokenStatus = await tokenManager.getTokenWithStatus(userId, 'gmail');

      if (!tokenStatus) {
        throw createError('No Gmail token found', 401);
      }

      if (tokenStatus.isExpired) {
        logger.info('Gmail token expired, attempting refresh', { userId });
        return await this.refreshAccessToken(userId);
      }

      const tokenData = tokenStatus.token;
      // Check if token will expire soon (within 5 minutes)
      const expiresIn = tokenData.expiresAt.getTime() - Date.now();
      if (expiresIn < 300000) { // 5 minutes
        return await this.refreshAccessToken(userId);
      }

      return tokenData.accessToken;
    } catch (error) {
      logger.error('Error getting valid Gmail access token', { error, userId });
      throw error;
    }
  }

  // STUB FUNCTION: Connect Gmail account
  async connectGmail(userId: string): Promise<{ success: boolean; message: string; authUrl?: string }> {
    try {
      const isConnected = await tokenManager.isTokenValid(userId, 'gmail');

      if (isConnected) {
        const authUrl = await this.initiateOAuth(userId);
        return { success: true, authUrl: authUrl.toString(), message: 'Gmail already connected' };
      }

      const authUrl = await this.initiateOAuth(userId);

      logger.info('Gmail connection initiated', { userId });
      return { success: true, authUrl: authUrl.toString(), message: 'Gmail connection initiated' };
    } catch (error) {
      logger.error('Error connecting Gmail', { error, userId });
      throw createError('Failed to connect Gmail', 500);
    }
  }

  // STUB FUNCTION: Fetch emails from Gmail
  async fetchEmails(
    userId: string,
    query?: string,
    maxResults: number = 10
  ): Promise<GmailEmail[]> {
    try {
      // MOCK MODE: If using a mock token, return fake data without calling API
      const accessToken = await this.getValidAccessToken(userId);
      if (accessToken.startsWith('mock-token-')) {
        logger.info('🧪 [GMAIL MOCK] Returning mock emails for testing', { userId });

        // Generate 1-3 mock emails
        const mockEmails: GmailEmail[] = Array.from({ length: Math.floor(Math.random() * 3) + 1 }).map((_, i) => ({
          id: `mock-email-${Date.now()}-${i}`,
          threadId: `mock-thread-${Date.now()}-${i}`,
          subject: `Amazon Invoice #${Math.floor(Math.random() * 100000)}`,
          from: 'auto-confirm@amazon.com',
          to: ['user@example.com'],
          snippet: 'Your order has been shipped. View your invoice.',
          body: 'Thank you for your order.',
          date: new Date().toISOString(),
          labels: ['INBOX'],
          isRead: false,
          hasAttachments: true
        }));

        return mockEmails;
      }

      const response = await this.requestWithToken(userId, (accessToken) =>
        axios.get(`${this.baseUrl}/messages`, {
          headers: { Authorization: `Bearer ${accessToken}` },
          params: {
            maxResults,
            q: query,
            includeSpamTrash: false
          }
        })
      );

      const messages = response.data.messages || [];
      const emails: GmailEmail[] = [];

      for (const message of messages.slice(0, maxResults)) {
        try {
          const messageDetail = await this.requestWithToken(userId, (accessToken) =>
            axios.get(`${this.baseUrl}/messages/${message.id}`, {
              headers: { Authorization: `Bearer ${accessToken}` },
              params: { format: 'metadata' }
            })
          );

          const emailData = messageDetail.data;
          const headers = emailData.payload.headers || [];
          const subject = headers.find((h: any) => h.name === 'Subject')?.value || 'No Subject';
          const from = headers.find((h: any) => h.name === 'From')?.value || 'Unknown Sender';
          const toHeader = headers.find((h: any) => h.name === 'To')?.value || '';

          emails.push({
            id: emailData.id,
            threadId: emailData.threadId,
            subject,
            from,
            to: toHeader.split(',').map((e: string) => e.trim()),
            snippet: emailData.snippet,
            body: emailData.snippet,
            date: new Date(parseInt(emailData.internalDate)).toISOString(),
            labels: emailData.labelIds || [],
            isRead: !emailData.labelIds?.includes('UNREAD'),
            hasAttachments: emailData.payload.parts?.some((part: any) => part.filename) || false
          });
        } catch (error) {
          logger.warn('Failed to fetch email details', { messageId: message.id, error });
        }
      }

      logger.info('Gmail emails fetched successfully', { userId, count: emails.length });
      return emails;
    } catch (error) {
      logger.error('Error fetching Gmail emails', { error, userId });
      throw createError('Failed to fetch Gmail emails', 500);
    }
  }

  async fetchMessage(
    userId: string,
    messageId: string,
    format: 'metadata' | 'full' = 'metadata'
  ): Promise<GmailMessageResponse> {
    const response = await this.requestWithToken(userId, (accessToken) =>
      axios.get(`${this.baseUrl}/messages/${messageId}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: { format }
      })
    );
    return response.data;
  }

  async fetchAttachment(
    userId: string,
    messageId: string,
    attachmentId: string
  ): Promise<{ data?: string }> {
    const response = await this.requestWithToken(userId, (accessToken) =>
      axios.get(`${this.baseUrl}/messages/${messageId}/attachments/${attachmentId}`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      })
    );
    return response.data;
  }

  // STUB FUNCTION: Search emails by criteria
  async searchEmails(
    userId: string,
    searchQuery: string,
    maxResults: number = 10
  ): Promise<GmailEmail[]> {
    try {
      const accessToken = await this.getValidAccessToken(userId);

      // TODO: Implement actual Gmail API search
      // This is a stub implementation
      logger.info('Searching Gmail emails', { userId, searchQuery, maxResults });

      // Mock search results
      const mockSearchResults: GmailEmail[] = [
        {
          id: 'search-result-1',
          threadId: 'thread-3',
          subject: `Search result for: ${searchQuery}`,
          from: 'search@example.com',
          to: ['user@example.com'],
          snippet: `Email matching search criteria: ${searchQuery}`,
          body: `<html><body>Search result content for: ${searchQuery}</body></html>`,
          date: new Date().toISOString(),
          labels: ['INBOX'],
          isRead: false,
          hasAttachments: false
        }
      ];

      logger.info('Gmail search completed successfully', { userId, count: mockSearchResults.length });
      return mockSearchResults;
    } catch (error) {
      logger.error('Error searching Gmail emails', { error, userId });
      throw createError('Failed to search Gmail emails', 500);
    }
  }

  private async requestWithToken<T>(
    userId: string,
    request: (accessToken: string) => Promise<T>
  ): Promise<T> {
    let accessToken = await this.getValidAccessToken(userId);
    try {
      return await request(accessToken);
    } catch (error: any) {
      if (this.shouldRetryWithRefresh(error)) {
        logger.warn('Gmail request unauthorized, refreshing token', {
          userId,
          status: error?.response?.status
        });
        accessToken = await this.refreshAccessToken(userId);
        return await request(accessToken);
      }
      throw error;
    }
  }

  private shouldRetryWithRefresh(error: any): boolean {
    const status = error?.response?.status;
    if (status === 401) {
      return true;
    }
    if (status === 403) {
      const data = error?.response?.data;
      const message = data?.error_description || data?.error || data?.message;
      return message ? String(message).toLowerCase().includes('invalid') : true;
    }
    return false;
  }

  async disconnect(userId: string): Promise<void> {
    try {
      await tokenManager.revokeToken(userId, 'gmail');
      logger.info('Gmail integration disconnected', { userId });
    } catch (error) {
      logger.error('Error disconnecting Gmail integration', { error, userId });
      throw createError('Failed to disconnect Gmail integration', 500);
    }
  }
}

export const gmailService = new GmailService();
export default gmailService;



