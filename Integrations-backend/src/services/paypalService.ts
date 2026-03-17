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

  /**
   * Create a drafts invoice in PayPal
   */
  async createInvoice(invoiceData: any): Promise<any> {
    try {
      const accessToken = await this.getAccessToken();
      const response = await axios.post(
        `${this.apiUrl}/v2/invoicing/invoices`,
        invoiceData,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation'
          }
        }
      );

      logger.info(`✅ [PAYPAL] Invoice created: ${JSON.stringify(response.data)}`);
      return response.data;
    } catch (error: any) {
      logger.error('❌ [PAYPAL] Failed to create invoice', {
        error: error.response?.data || error.message
      });
      throw error;
    }
  }

  /**
   * Send a draft invoice to the customer
   */
  async sendInvoice(invoiceId: string): Promise<boolean> {
    try {
      const accessToken = await this.getAccessToken();
      await axios.post(
        `${this.apiUrl}/v2/invoicing/invoices/${invoiceId}/send`,
        {
          send_to_recipient: true,
          send_to_invoicer: false
        },
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      logger.info('✅ [PAYPAL] Invoice sent', { invoiceId });
      return true;
    } catch (error: any) {
      if (error.response?.data) {
        logger.error(`❌ [PAYPAL] Send Invoice API Error Detail: ${JSON.stringify(error.response.data)}`);
      }
      logger.error(`❌ [PAYPAL] Failed to send invoice ${invoiceId}: ${error.message}`);
      return false;
    }
  }
  /**
   * Create a Vault Setup Token for saving a payment method (v3)
   */
  async createVaultSetupToken(customerId?: string): Promise<any> {
    try {
      const accessToken = await this.getAccessToken();
      const response = await axios.post(
        `${this.apiUrl}/v3/vault/setup-tokens`,
        {
          payment_source: {
            paypal: {
              usage_type: "MERCHANT",
              customer_type: "CONSUMER",
              experience_context: {
                return_url: "https://example.com/return",
                cancel_url: "https://example.com/cancel"
              }
            }
          }
        },
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      logger.info('✅ [PAYPAL] Vault Setup Token created', { id: response.data.id });
      return response.data;
    } catch (error: any) {
      logger.error('❌ [PAYPAL] Failed to create vault setup token', {
        error: error.response?.data || error.message
      });
      throw error;
    }
  }

  /**
   * Create a permanent Payment Token from a Setup Token (v3)
   */
  async createPaymentToken(setupTokenId: string): Promise<any> {
    try {
      const accessToken = await this.getAccessToken();
      const response = await axios.post(
        `${this.apiUrl}/v3/vault/payment-tokens`,
        {
          payment_source: {
            token: {
              id: setupTokenId,
              type: "SETUP_TOKEN"
            }
          }
        },
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      logger.info('✅ [PAYPAL] Permanent Payment Token created', { id: response.data.id });
      return response.data;
    } catch (error: any) {
      logger.error('❌ [PAYPAL] Failed to create payment token', {
        error: error.response?.data || error.message
      });
      throw error;
    }
  }

  /**
   * Charge a saved Payment Token (Auto-Charge)
   */
  async chargePaymentToken(paymentTokenId: string, amount: string, currency: string, referenceId: string): Promise<any> {
    try {
      const accessToken = await this.getAccessToken();
      const response = await axios.post(
        `${this.apiUrl}/v2/checkout/orders`,
        {
          intent: "CAPTURE",
          purchase_units: [
            {
              reference_id: referenceId,
              amount: {
                currency_code: currency.toUpperCase(),
                value: amount
              }
            }
          ],
          payment_source: {
            vault_id: paymentTokenId
          }
        },
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      logger.info('✅ [PAYPAL] Auto-charge order created', { id: response.data.id });
      return response.data;
    } catch (error: any) {
      logger.error('❌ [PAYPAL] Failed to charge payment token', {
        error: error.response?.data || error.message
      });
      throw error;
    }
  }
}

export default new PaypalService();
