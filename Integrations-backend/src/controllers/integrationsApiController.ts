import { Request, Response } from 'express';
import axios from 'axios';
import logger from '../utils/logger';
import { storeOAuthToken } from '../models/oauthToken';
import { supabase } from '../database/supabaseClient';

const LWA_TOKEN_URL = 'https://api.amazon.com/auth/o2/token';
const SELLERS_ME_URL = 'https://sellingpartnerapi-na.amazon.com/sellers/v1/marketplaceParticipations';

export const integrationsApiController = {
  /**
   * POST /integrations-api/amazon/oauth/process
   * Body: { code: string, state: string }
   * Returns seller identity and stores refresh_token centrally (implementation-specific)
   */
  async processAmazonOAuth(req: Request, res: Response) {
    try {
      const { code, state } = req.body || {};
      if (!code || !state) {
        return res.status(400).json({ success: false, error: 'missing_parameters' });
      }

      // Optional: Validate state. In production, look up state in Redis/DB
      // For now, accept and proceed; upstream auth service already validates CSRF.

      // Exchange code for tokens (Amazon LWA)
      // Use AMAZON_SPAPI_CLIENT_ID as fallback if AMAZON_CLIENT_ID not set (for consistency)
      const client_id = (process.env as any)['AMAZON_CLIENT_ID'] || (process.env as any)['AMAZON_SPAPI_CLIENT_ID'] || '';
      const client_secret = (process.env as any)['AMAZON_CLIENT_SECRET'] || (process.env as any)['AMAZON_SPAPI_CLIENT_SECRET'] || '';
      const redirect_uri = (process.env as any)['AMAZON_REDIRECT_URI'] || '';
      if (!client_id || !client_secret || !redirect_uri) {
        return res.status(500).json({ success: false, error: 'server_misconfigured' });
      }
      let access_token: string;
      let refresh_token: string;
      try {
        const tokenResp = await axios.post(
          LWA_TOKEN_URL,
          new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            client_id,
            client_secret,
            redirect_uri,
          }),
          { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15000 }
        );
        access_token = tokenResp.data?.access_token;
        refresh_token = tokenResp.data?.refresh_token;
        if (!access_token || !refresh_token) {
          return res.status(400).json({ success: false, error: 'token_exchange_failed' });
        }
      } catch (e: any) {
        logger.error('Amazon LWA token exchange failed', { error: e?.message });
        return res.status(400).json({ success: false, error: 'token_exchange_failed' });
      }

      // Fetch seller identity
      let sellerId: string | undefined;
      let companyName: string | undefined;
      let marketplaces: string[] = [];
      try {
        const sellersResp = await axios.get(SELLERS_ME_URL, {
          headers: {
            Authorization: `Bearer ${access_token}`,
            'x-amz-access-token': access_token,
          },
          timeout: 15000,
        });
        const payload = sellersResp.data?.payload ?? sellersResp.data;
        const parts = Array.isArray(payload?.marketplaceParticipations)
          ? payload.marketplaceParticipations
          : Array.isArray(payload)
          ? payload
          : [];
        if (parts.length > 0) {
          const first = parts[0] || {};
          sellerId = first?.participation?.sellerId || first?.sellerId;
          companyName = first?.participation?.sellerName || first?.sellerName || 'Unknown Company';
          markets: for (const p of parts) {
            const id = p?.marketplace?.id || p?.marketplaceId;
            if (id) marketplaces.push(id);
          }
        }
        if (!sellerId) return res.status(400).json({ success: false, error: 'missing_seller_id' });
      } catch (e: any) {
        logger.error('Amazon Sellers API failed', { error: e?.message });
        return res.status(502).json({ success: false, error: 'sellers_api_failed' });
      }

      // Store refresh_token securely (centralized)
      try {
        await storeOAuthToken(sellerId!, refresh_token);
      } catch (e: any) {
        logger.error('Failed to store refresh token', { error: e?.message });
        return res.status(500).json({ success: false, error: 'storage_failed' });
      }

      // Stripe: get or create customer (idempotent) via payments API if configured
      try {
        const paymentsUrl = (process.env as any)['PAYMENTS_API_URL'];
        const userIdHeader = req.header('X-User-Id');
        const userEmail = req.header('X-User-Email');
        if (paymentsUrl && userIdHeader && userEmail) {
          const resp = await axios.post(`${paymentsUrl}/api/v1/stripe/get-or-create-customer`, {
            userId: Number(userIdHeader),
            email: userEmail,
          }, { headers: { Authorization: req.headers['authorization'] || '' } });
          const customerId = resp.data?.data?.customerId;
          if (customerId) {
            await supabase
              .from('users')
              .update({ stripe_customer_id: customerId })
              .eq('id', userIdHeader);
          }
        }
      } catch (e: any) {
        logger.warn('Stripe customer creation post-login failed (non-blocking)', { error: e?.message });
      }

      return res.status(200).json({
        success: true,
        data: {
          amazon_seller_id: sellerId,
          company_name: companyName,
          marketplaces,
        },
      });
    } catch (error: any) {
      logger.error('Unexpected error in processAmazonOAuth', { error: error?.message });
      return res.status(500).json({ success: false, error: 'unexpected_error' });
    }
  },
};

export default integrationsApiController;

