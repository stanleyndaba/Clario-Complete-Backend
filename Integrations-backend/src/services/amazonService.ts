import axios from 'axios';
import zlib from 'zlib';
// config import removed; using process.env directly for Amazon settings
import logger from '../utils/logger';
import tokenManager from '../utils/tokenManager';
import { createError } from '../utils/errorHandler';
import { createStateValidator } from '../utils/stateValidator';
import { encryptToken, decryptToken } from '../utils/tokenCrypto';
import { getRedisClient } from '../utils/redisClient';
import { withRetry } from '../utils/retry';

export interface AmazonClaim {
  id: string;
  claimId: string;
  claimType: string;
  claimStatus: string;
  claimAmount: number;
  currency: string;
  createdAt: string;
  updatedAt: string;
  description?: string;
}

export interface AmazonInventory {
  id: string;
  sku: string;
  asin: string;
  title: string;
  quantity: number;
  price: number;
  currency: string;
  condition: string;
  lastUpdated: string;
}

export interface AmazonFee {
  id: string;
  feeType: string;
  feeAmount: number;
  currency: string;
  orderId?: string;
  sku?: string;
  date: string;
  description?: string;
}

export interface AmazonOAuthResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}

export class AmazonService {
  private authUrl = 'https://api.amazon.com/auth/o2/token';
  private reportsBase = '/reports/2021-06-30';

  async initiateOAuth(userId: string): Promise<string> {
    try {
      // Generate secure OAuth state
      const redisClient = await getRedisClient();
      const stateValidator = createStateValidator(redisClient);
      const state = await stateValidator.generateState(userId);

      const authUrl = new URL(process.env.AMAZON_AUTH_URL || 'https://www.amazon.com/ap/oa');
      authUrl.searchParams.set('client_id', process.env.AMAZON_CLIENT_ID || '');
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('redirect_uri', process.env.AMAZON_REDIRECT_URI || '');
      authUrl.searchParams.set('scope', 'sellingpartnerapi::notifications sellingpartnerapi::migration');
      authUrl.searchParams.set('state', state);

      logger.info('Amazon OAuth initiated with secure state', { userId, state });
      return authUrl.toString();
    } catch (error) {
      logger.error('Error initiating Amazon OAuth', { error, userId });
      throw createError('Failed to initiate Amazon OAuth', 500);
    }
  }

  async handleOAuthCallback(code: string, userId: string): Promise<void> {
    try {
      const tokenResponse = await withRetry(() => axios.post(this.authUrl, {
        grant_type: 'authorization_code',
        code,
        client_id: process.env.AMAZON_CLIENT_ID || '',
        client_secret: process.env.AMAZON_CLIENT_SECRET || '',
        redirect_uri: process.env.AMAZON_REDIRECT_URI || ''
      }), { retries: 3, minDelayMs: 300, maxDelayMs: 2500 });

      const tokenData: AmazonOAuthResponse = tokenResponse.data;
      const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000);

      // Encrypt tokens before saving
      const encryptedAccessToken = encryptToken(tokenData.access_token);
      const encryptedRefreshToken = encryptToken(tokenData.refresh_token);

      await tokenManager.saveToken(userId, 'amazon', {
        accessToken: encryptedAccessToken,
        refreshToken: encryptedRefreshToken,
        expiresAt
      });

      // Mark integration status active
      await this.upsertIntegrationStatus(userId, 'active', { source: 'oauth_callback' });

      logger.info('Amazon OAuth completed successfully', { userId });
    } catch (error) {
      const message = (error as any)?.response?.data || (error as Error).message;
      logger.error('Error handling Amazon OAuth callback', { userId, error: message });
      throw createError('Failed to complete Amazon OAuth', 400);
    }
  }

  async refreshAccessToken(userId: string): Promise<string> {
    try {
      const tokenData = await tokenManager.getToken(userId, 'amazon');
      if (!tokenData) {
        throw createError('No Amazon token found', 401);
      }

      // Decrypt tokens before using
      const decryptedRefreshToken = decryptToken(tokenData.refreshToken);

      const response = await withRetry(() => axios.post(this.authUrl, {
        grant_type: 'refresh_token',
        refresh_token: decryptedRefreshToken,
        client_id: process.env.AMAZON_CLIENT_ID || '',
        client_secret: process.env.AMAZON_CLIENT_SECRET || ''
      }), { retries: 3, minDelayMs: 300, maxDelayMs: 2500 });

      const newTokenData: AmazonOAuthResponse = response.data;
      const expiresAt = new Date(Date.now() + newTokenData.expires_in * 1000);

      // Encrypt new tokens before saving
      const encryptedAccessToken = encryptToken(newTokenData.access_token);
      const encryptedRefreshToken = encryptToken(newTokenData.refresh_token);

      await tokenManager.refreshToken(userId, 'amazon', {
        accessToken: encryptedAccessToken,
        refreshToken: encryptedRefreshToken,
        expiresAt
      });

      logger.info('Amazon access token refreshed', { userId });
      await this.upsertIntegrationStatus(userId, 'active', { source: 'refresh' });
      return newTokenData.access_token;
    } catch (error) {
      const status = (error as any)?.response?.status;
      const errMsg = (error as any)?.response?.data || (error as Error).message;
      logger.warn('Error refreshing Amazon access token', { userId, status, error: errMsg });
      if (status === 401) {
        await this.upsertIntegrationStatus(userId, 'revoked', { source: 'refresh_401', error: errMsg });
        throw createError('Amazon token revoked. Please reconnect your account.', 401);
      }
      throw createError('Failed to refresh Amazon access token', 500);
    }
  }

  async getValidAccessToken(userId: string): Promise<string> {
    try {
      const tokenData = await tokenManager.getToken(userId, 'amazon');
      if (!tokenData) {
        throw createError('No Amazon token found', 401);
      }

      // Check if token is expired or will expire soon (within 5 minutes)
      const expiresIn = tokenData.expiresAt.getTime() - Date.now();
      if (expiresIn < 300000) { // 5 minutes
        return await this.refreshAccessToken(userId);
      }

      // Decrypt access token before returning
      return decryptToken(tokenData.accessToken);
    } catch (error) {
      const status = (error as any)?.response?.status;
      const errMsg = (error as any)?.response?.data || (error as Error).message;
      logger.warn('Error getting valid Amazon access token', { userId, status, error: errMsg });
      if (status === 401) {
        await this.upsertIntegrationStatus(userId, 'expired', { source: 'getValidAccessToken_401', error: errMsg });
      }
      throw error;
    }
  }

  // STUB FUNCTION: Fetch claims from Amazon SP-API
  async fetchClaims(userId: string, startDate?: string, endDate?: string): Promise<AmazonClaim[]> {
    try {
      // Use reimbursements report as claims source
      const reimbursements = await this.getRealFbaReimbursements(userId, startDate, endDate);
      const claims: AmazonClaim[] = reimbursements.map((r: any, idx: number) => ({
        id: r.reimbursement_id || `reimb-${idx}`,
        claimId: r.reimbursement_id || r.case_id || `reimb-${idx}`,
        claimType: 'reimbursement',
        claimStatus: r.status || 'approved',
        claimAmount: Number(r.amount || r.total_amount || r.reimbursement_amount || 0),
        currency: r.currency || 'USD',
        createdAt: r.posted_date || r.created_at || new Date().toISOString(),
        updatedAt: r.updated_at || r.posted_date || new Date().toISOString(),
        description: r.reason || r.description || 'FBA Reimbursement'
      }));
      logger.info('Amazon claims fetched successfully', { userId, count: claims.length });
      return claims;
    } catch (error) {
      const status = (error as any)?.response?.status;
      const errMsg = (error as any)?.response?.data || (error as Error).message;
      logger.error('Error fetching Amazon claims', { userId, status, error: errMsg });
      if (status === 401) {
        await this.upsertIntegrationStatus(userId, 'revoked', { source: 'claims_401', error: errMsg });
        throw createError('Amazon permissions revoked. Please reconnect.', 401);
      }
      throw createError('Failed to fetch Amazon claims', 500);
    }
  }

  // STUB FUNCTION: Fetch inventory from Amazon SP-API
  async fetchInventory(userId: string, marketplaceId?: string): Promise<AmazonInventory[]> {
    try {
      const items = await this.getRealInventoryData(userId, marketplaceId);
      logger.info('Amazon inventory fetched successfully', { userId, count: items.length });
      return items;
    } catch (error) {
      const status = (error as any)?.response?.status;
      const errMsg = (error as any)?.response?.data || (error as Error).message;
      logger.error('Error fetching Amazon inventory', { userId, status, error: errMsg });
      if (status === 401) {
        await this.upsertIntegrationStatus(userId, 'revoked', { source: 'inventory_401', error: errMsg });
        throw createError('Amazon permissions revoked. Please reconnect.', 401);
      }
      throw createError('Failed to fetch Amazon inventory', 500);
    }
  }

  // STUB FUNCTION: Fetch fees from Amazon SP-API
  async fetchFees(userId: string, startDate?: string, endDate?: string): Promise<AmazonFee[]> {
    try {
      const fees = await this.getRealFeeDiscrepancies(userId, startDate, endDate);
      logger.info('Amazon fees fetched successfully', { userId, count: fees.length });
      return fees;
    } catch (error) {
      const status = (error as any)?.response?.status;
      const errMsg = (error as any)?.response?.data || (error as Error).message;
      logger.error('Error fetching Amazon fees', { userId, status, error: errMsg });
      if (status === 401) {
        await this.upsertIntegrationStatus(userId, 'revoked', { source: 'fees_401', error: errMsg });
        throw createError('Amazon permissions revoked. Please reconnect.', 401);
      }
      throw createError('Failed to fetch Amazon fees', 500);
    }
  }

  private async upsertIntegrationStatus(userId: string, status: 'active'|'revoked'|'expired', metadata?: any) {
    try {
      const { supabase } = await import('../database/supabaseClient');
      await supabase
        .from('integration_status')
        .upsert({ user_id: userId, provider: 'amazon', status, updated_at: new Date().toISOString(), metadata }, { onConflict: 'user_id,provider' });
    } catch (e) {
      logger.warn('Failed to upsert integration status', { userId, status, error: (e as Error).message });
    }
  }

  async disconnect(userId: string): Promise<void> {
    try {
      await tokenManager.revokeToken(userId, 'amazon');
      logger.info('Amazon integration disconnected', { userId });
    } catch (error) {
      logger.error('Error disconnecting Amazon integration', { error, userId });
      throw createError('Failed to disconnect Amazon integration', 500);
    }
  }

  // =====================
  // Real SP-API methods
  // =====================

  private getRegionBaseUrl(): string {
    // Extend to EU/FE if needed
    return process.env.AMAZON_REGION === 'eu-west-1'
      ? 'https://sellingpartnerapi-eu.amazon.com'
      : (process.env.AMAZON_REGION === 'us-west-2'
          ? 'https://sellingpartnerapi-fe.amazon.com'
          : 'https://sellingpartnerapi-na.amazon.com');
  }

  private async requestReport(userId: string, reportType: string, marketplaceIds: string[], dataStartTime?: string, dataEndTime?: string): Promise<string> {
    const accessToken = await this.getValidAccessToken(userId);
    const body: any = {
      reportType,
      marketplaceIds,
    };
    if (dataStartTime) body.dataStartTime = dataStartTime;
    if (dataEndTime) body.dataEndTime = dataEndTime;

    const base = this.getRegionBaseUrl();
    const resp = await axios.post(`${base}${this.reportsBase}/reports`, body, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'x-amz-access-token': accessToken,
        'Content-Type': 'application/json'
      }
    });
    return resp.data?.payload?.reportId || resp.data?.reportId;
  }

  private async pollReportDocument(userId: string, reportId: string, timeoutMs = 5 * 60 * 1000): Promise<{ url: string; compressionAlgorithm?: string } | null> {
    const accessToken = await this.getValidAccessToken(userId);
    const base = this.getRegionBaseUrl();
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const statusResp = await axios.get(`${base}${this.reportsBase}/reports/${reportId}`, {
        headers: { Authorization: `Bearer ${accessToken}`, 'x-amz-access-token': accessToken }
      });
      const payload = statusResp.data?.payload || statusResp.data;
      if (payload?.reportDocumentId) {
        const docId = payload.reportDocumentId;
        const docResp = await axios.get(`${base}${this.reportsBase}/documents/${docId}`, {
          headers: { Authorization: `Bearer ${accessToken}`, 'x-amz-access-token': accessToken }
        });
        const doc = docResp.data?.payload || docResp.data;
        return { url: doc?.url, compressionAlgorithm: doc?.compressionAlgorithm };
      }
      await new Promise(r => setTimeout(r, 5000));
    }
    return null;
  }

  private async downloadAndParseDocument(doc: { url: string; compressionAlgorithm?: string }): Promise<any[]> {
    const resp = await axios.get(doc.url || '', { responseType: 'arraybuffer' });
    let buffer: Buffer = Buffer.from(resp.data);
    if ((doc.compressionAlgorithm || '').toUpperCase() === 'GZIP' || resp.headers?.['content-encoding'] === 'gzip') {
      buffer = zlib.gunzipSync(buffer);
    }
    const text = buffer.toString('utf8');
    return this.parseDelimited(text);
  }

  private parseDelimited(text: string): any[] {
    const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
    if (lines.length === 0) return [];
    const firstLine = lines[0]!;
    const delimiter = firstLine.includes('\t') ? '\t' : ',';
    const header = firstLine.split(delimiter).map(h => h.trim());
    const records: any[] = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i]!;
      const cols = line.split(delimiter);
      const obj: any = {};
      for (let j = 0; j < header.length; j++) {
        const key = header[j] ?? `col_${j}`;
        obj[key] = j < cols.length ? cols[j] : '';
      }
      records.push(obj);
    }
    return records;
  }

  async getRealFbaReimbursements(userId: string, startDate?: string, endDate?: string): Promise<any[]> {
    const marketplaceIds = (process.env.AMAZON_MARKETPLACE_IDS || process.env.AMAZON_MARKETPLACE_ID || 'ATVPDKIKX0DER').toString().split(',').map(s => s.trim());
    const reportId = await this.requestReport(userId, 'GET_FBA_REIMBURSEMENTS_DATA', marketplaceIds, startDate, endDate);
    const doc = await this.pollReportDocument(userId, reportId);
    if (!doc) return [];
    const rows = await this.downloadAndParseDocument(doc);
    return rows;
  }

  async getRealFeeDiscrepancies(userId: string, startDate?: string, endDate?: string): Promise<AmazonFee[]> {
    const marketplaceIds = (process.env.AMAZON_MARKETPLACE_IDS || process.env.AMAZON_MARKETPLACE_ID || 'ATVPDKIKX0DER').toString().split(',').map(s => s.trim());
    const reportId = await this.requestReport(userId, 'GET_FBA_ESTIMATED_FBA_FEES_TXT', marketplaceIds, startDate, endDate);
    const doc = await this.pollReportDocument(userId, reportId);
    if (!doc) return [];
    const rows = await this.downloadAndParseDocument(doc);
    const fees: AmazonFee[] = rows.map((r: any, idx: number) => ({
      id: r.asin || r.sku || `fee-${idx}`,
      feeType: 'estimated_fba_fee',
      feeAmount: Number(r.estimated_fee_total || r.total_fees || r.fee || 0),
      currency: r.currency || 'USD',
      sku: r.sku,
      date: new Date().toISOString(),
      description: 'Estimated FBA fees (preview)'
    }));
    return fees;
  }

  async getRealShipmentData(userId: string, startDate?: string, endDate?: string): Promise<any[]> {
    const marketplaceIds = (process.env.AMAZON_MARKETPLACE_IDS || process.env.AMAZON_MARKETPLACE_ID || 'ATVPDKIKX0DER').toString().split(',').map(s => s.trim());
    const reportId = await this.requestReport(userId, 'GET_FBA_FULFILLMENT_CUSTOMER_SHIPMENT_DATA', marketplaceIds, startDate, endDate);
    const doc = await this.pollReportDocument(userId, reportId);
    if (!doc) return [];
    const rows = await this.downloadAndParseDocument(doc);
    return rows;
  }

  async getRealInventoryData(userId: string, marketplaceId?: string): Promise<AmazonInventory[]> {
    const accessToken = await this.getValidAccessToken(userId);
    const base = this.getRegionBaseUrl();
    const params: any = {
      marketplaceIds: (marketplaceId || process.env.AMAZON_MARKETPLACE_ID || 'ATVPDKIKX0DER'),
      granularityType: 'Marketplace',
      granularityId: marketplaceId || process.env.AMAZON_MARKETPLACE_ID || 'ATVPDKIKX0DER'
    };
    const resp = await axios.get(`${base}/fba/inventory/v1/summaries`, {
      headers: { Authorization: `Bearer ${accessToken}`, 'x-amz-access-token': accessToken },
      params
    });
    const summaries = resp.data?.payload?.inventorySummaries || [];
    const items: AmazonInventory[] = summaries.map((s: any, idx: number) => ({
      id: s?.asin || s?.sellerSku || `inv-${idx}`,
      sku: s?.sellerSku || '',
      asin: s?.asin || '',
      title: s?.productName || s?.sellerSku || '',
      quantity: Number(s?.inventoryDetails?.availableQuantity ?? 0),
      price: Number(0),
      currency: 'USD',
      condition: String(s?.condition || 'New'),
      lastUpdated: (s?.lastUpdatedTime || new Date().toISOString())
    }));
    return items;
  }
}

export const amazonService = new AmazonService();
export default amazonService; 