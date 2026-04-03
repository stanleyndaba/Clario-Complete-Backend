import axios from 'axios';
import config from '../config/env';
import logger from '../utils/logger';
import tokenManager, { TokenData } from '../utils/tokenManager';
import { createError } from '../utils/errorHandler';
import { supabase, convertUserIdToUuid } from '../database/supabaseClient';

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

export interface GmailSendAttachment {
  filename: string;
  contentType: string;
  data: Buffer;
}

export interface GmailSendReplyOptions {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  bodyText: string;
  threadId?: string | null;
  inReplyTo?: string | null;
  references?: string[];
  attachments?: GmailSendAttachment[];
}

export class GmailService {
  private baseUrl = 'https://gmail.googleapis.com/gmail/v1/users/me';
  private authUrl = 'https://oauth2.googleapis.com/token';

  private encodeBase64Url(input: Buffer | string): string {
    return Buffer.from(input)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');
  }

  private buildRawMessage(options: GmailSendReplyOptions): string {
    const to = options.to.join(', ');
    const cc = (options.cc || []).join(', ');
    const bcc = (options.bcc || []).join(', ');
    const subject = options.subject;
    const references = (options.references || []).filter(Boolean).join(' ');
    const attachments = options.attachments || [];

    const baseHeaders = [
      `To: ${to}`,
      cc ? `Cc: ${cc}` : null,
      bcc ? `Bcc: ${bcc}` : null,
      `Subject: ${subject}`,
      'MIME-Version: 1.0',
      options.inReplyTo ? `In-Reply-To: <${String(options.inReplyTo).replace(/[<>]/g, '')}>` : null,
      references ? `References: ${references.split(/\s+/).map((value) => `<${String(value).replace(/[<>]/g, '')}>`).join(' ')}` : null
    ].filter(Boolean) as string[];

    if (!attachments.length) {
      const raw = [
        ...baseHeaders,
        'Content-Type: text/plain; charset="UTF-8"',
        'Content-Transfer-Encoding: 7bit',
        '',
        options.bodyText
      ].join('\r\n');

      return this.encodeBase64Url(raw);
    }

    const boundary = `margin-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const parts: string[] = [
      ...baseHeaders,
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/plain; charset="UTF-8"',
      'Content-Transfer-Encoding: 7bit',
      '',
      options.bodyText
    ];

    for (const attachment of attachments) {
      parts.push(
        `--${boundary}`,
        `Content-Type: ${attachment.contentType}; name="${attachment.filename}"`,
        'Content-Transfer-Encoding: base64',
        `Content-Disposition: attachment; filename="${attachment.filename}"`,
        '',
        attachment.data.toString('base64').replace(/(.{76})/g, '$1\r\n').trim()
      );
    }

    parts.push(`--${boundary}--`, '');

    return this.encodeBase64Url(parts.join('\r\n'));
  }

  private async getSourceTokenData(userId: string): Promise<TokenData | null> {
    try {
      const dbUserId = convertUserIdToUuid(userId);
      const { data: source, error } = await supabase
        .from('evidence_sources')
        .select('metadata')
        .eq('user_id', dbUserId)
        .eq('provider', 'gmail')
        .eq('status', 'connected')
        .maybeSingle();

      if (error || !source?.metadata) {
        return null;
      }

      const metadata = source.metadata || {};
      if (!metadata.access_token) {
        return null;
      }

      const expiresAt = metadata.expires_at
        ? new Date(metadata.expires_at)
        : new Date(Date.now() + 55 * 60 * 1000);

      return {
        accessToken: metadata.access_token,
        refreshToken: metadata.refresh_token || '',
        expiresAt
      };
    } catch (error: any) {
      logger.debug('Failed to load Gmail token from evidence source metadata', {
        userId,
        error: error.message
      });
      return null;
    }
  }

  private async persistSourceTokenData(userId: string, tokenData: TokenData): Promise<void> {
    try {
      const dbUserId = convertUserIdToUuid(userId);
      const { data: source } = await supabase
        .from('evidence_sources')
        .select('id, metadata')
        .eq('user_id', dbUserId)
        .eq('provider', 'gmail')
        .maybeSingle();

      if (!source?.id) {
        return;
      }

      await supabase
        .from('evidence_sources')
        .update({
          metadata: {
            ...(source.metadata || {}),
            access_token: tokenData.accessToken,
            refresh_token: tokenData.refreshToken || undefined,
            expires_at: tokenData.expiresAt.toISOString(),
            token_source: 'gmail_service'
          },
          updated_at: new Date().toISOString()
        })
        .eq('id', source.id);
    } catch (error: any) {
      logger.debug('Failed to persist Gmail token into evidence source metadata', {
        userId,
        error: error.message
      });
    }
  }

  async initiateOAuth(userId: string): Promise<string> {
    try {
      const authUrl = new URL(config.GMAIL_AUTH_URL!);
      authUrl.searchParams.set('client_id', config.GMAIL_CLIENT_ID!);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('redirect_uri', config.GMAIL_REDIRECT_URI!);
      authUrl.searchParams.set(
        'scope',
        'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.send'
      );
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
      const tokenData = tokenStatus?.token || await this.getSourceTokenData(userId);

      if (!tokenData) {
        throw createError('No Gmail token found', 401);
      }

      if (!tokenData.refreshToken) {
        logger.error('No Gmail refresh token available', { userId });
        throw createError('No Gmail refresh token available', 401);
      }

      // Use URLSearchParams for proper form-urlencoded serialization
      // Google's token endpoint requires application/x-www-form-urlencoded
      const params = new URLSearchParams();
      params.append('grant_type', 'refresh_token');
      params.append('refresh_token', tokenData.refreshToken);
      params.append('client_id', config.GMAIL_CLIENT_ID!);
      params.append('client_secret', config.GMAIL_CLIENT_SECRET!);

      const response = await axios.post(this.authUrl, params);

      const newTokenData: GmailOAuthResponse = response.data;
      const expiresAt = new Date(Date.now() + newTokenData.expires_in * 1000);
      const nextTokenData: TokenData = {
        accessToken: newTokenData.access_token,
        refreshToken: newTokenData.refresh_token || tokenData.refreshToken,
        expiresAt
      };

      try {
        await tokenManager.refreshToken(userId, 'gmail', nextTokenData);
      } catch (refreshStoreError: any) {
        logger.warn('Failed to persist refreshed Gmail token to tokenManager, falling back to evidence source metadata', {
          userId,
          error: refreshStoreError.message
        });
      }

      await this.persistSourceTokenData(userId, nextTokenData);

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
      const sourceTokenData = await this.getSourceTokenData(userId);

      if (!tokenStatus && !sourceTokenData) {
        throw createError('No Gmail token found', 401);
      }

      if (tokenStatus?.isExpired) {
        logger.info('Gmail token expired, attempting refresh', { userId });
        return await this.refreshAccessToken(userId);
      }

      const tokenData = tokenStatus?.token || sourceTokenData!;
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
      // Check if using mock token - skip ingestion for mock sources
      const accessToken = await this.getValidAccessToken(userId);
      if (accessToken.startsWith('mock-token-') || accessToken.startsWith('mock-')) {
        logger.info('⏭️ [GMAIL] Skipping mock token (no fake documents will be created)', { userId });
        return []; // Return empty - no fake documents
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
              params: { format: 'full' }
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
    // Skip mock email IDs - no fake messages
    if (messageId.startsWith('mock-email-') || messageId.startsWith('mock-')) {
      logger.warn('⏭️ [GMAIL] Skipping mock message ID', { userId, messageId });
      throw createError('Mock messages are not supported', 400);
    }

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

  async sendReply(
    userId: string,
    options: GmailSendReplyOptions
  ): Promise<{ id: string; threadId?: string }> {
    try {
      const raw = this.buildRawMessage(options);
      const response = await this.requestWithToken(userId, (accessToken) =>
        axios.post(`${this.baseUrl}/messages/send`, {
          raw,
          threadId: options.threadId || undefined
        }, {
          headers: { Authorization: `Bearer ${accessToken}` }
        })
      );

      logger.info('Gmail reply sent successfully', {
        userId,
        threadId: options.threadId || null,
        to: options.to
      });

      return response.data;
    } catch (error: any) {
      const status = error?.response?.status;
      const reason = error?.response?.data?.error?.message || error?.message || 'Failed to send Gmail reply';
      logger.error('Error sending Gmail reply', {
        userId,
        status,
        error: reason
      });

      if (status === 403 && /scope|permission|insufficient/i.test(String(reason))) {
        throw createError('Gmail reply permission is not available. Reconnect Gmail to grant send access.', 403);
      }

      throw createError(reason, status || 500);
    }
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



