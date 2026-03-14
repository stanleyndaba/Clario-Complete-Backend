import axios from 'axios';
import config from '../config/env';
import logger from '../utils/logger';

class PaypalService {
  private clientId: string;
  private clientSecret: string;
  private webhookId: string;
  private apiUrl: string;

  constructor() {
    this.clientId = config.PAYPAL_CLIENT_ID || '';
    this.clientSecret = config.PAYPAL_CLIENT_SECRET || '';
    this.webhookId = config.PAYPAL_WEBHOOK_ID || '';
    
    // Choose API URL based on environment or key prefix
    // Sandbox keys usually start with 'A' (Client ID) and Secret starts with 'E'
    // But better to check config or use live by default if not specified
    this.apiUrl = config.NODE_ENV === 'production' 
      ? 'https://api-m.paypal.com' 
      : 'https://api-m.sandbox.paypal.com';
  }

  /**
   * Obtain an OAuth2 access token from PayPal
   */
  async getAccessToken(): Promise<string> {
    try {
      const auth = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
      const response = await axios.post(
        `${this.apiUrl}/v1/oauth2/token`,
        'grant_type=client_credentials',
        {
          headers: {
            'Authorization': `Basic ${auth}`,
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        }
      );

      return response.data.access_token;
    } catch (error: any) {
      logger.error('❌ [PAYPAL] Failed to obtain access token', {
        error: error.response?.data || error.message
      });
      throw new Error('Failed to authenticate with PayPal');
    }
  }

  /**
   * Verify the signature of an incoming webhook request
   */
  async verifyWebhookSignature(
    headers: any,
    body: any
  ): Promise<boolean> {
    try {
      const accessToken = await this.getAccessToken();

      const verificationPayload = {
        transmission_id: headers['paypal-transmission-id'],
        transmission_time: headers['paypal-transmission-time'],
        cert_url: headers['paypal-cert-url'],
        auth_algo: headers['paypal-auth-algo'],
        transmission_sig: headers['paypal-transmission-sig'],
        webhook_id: this.webhookId,
        webhook_event: body
      };

      const response = await axios.post(
        `${this.apiUrl}/v1/notifications/verify-webhook-signature`,
        verificationPayload,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const isVerified = response.data?.verification_status === 'SUCCESS';
      
      if (!isVerified) {
        logger.warn('🚨 [PAYPAL] Webhook signature verification failed', {
          status: response.data?.verification_status
        });
      }

      return isVerified;
    } catch (error: any) {
      logger.error('❌ [PAYPAL] Webhook verification error', {
        error: error.response?.data || error.message
      });
      return false;
    }
  }
}

export default new PaypalService();
