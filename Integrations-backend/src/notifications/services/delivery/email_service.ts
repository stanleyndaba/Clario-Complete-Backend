import { getLogger } from '../../../utils/logger';
import Notification from '../../models/notification';
import sgMail from '@sendgrid/mail';
import { Resend } from 'resend';
import { supabaseAdmin } from '../../../database/supabaseClient';

const logger = getLogger('EmailService');

export interface EmailConfig {
  provider: 'sendgrid' | 'postmark' | 'resend';
  apiKey: string;
  fromEmail: string;
  fromName: string;
  replyTo?: string;
}

export interface EmailTemplate {
  subject: string;
  html: string;
  text: string;
}

export class EmailService {
  private config: EmailConfig;
  private isInitialized: boolean = false;
  private resend: Resend | null = null;

  constructor() {
    const provider = (process.env.EMAIL_PROVIDER as 'sendgrid' | 'postmark' | 'resend') || 'sendgrid';
    let apiKey = process.env.EMAIL_API_KEY || '';

    // Fallback to provider-specific keys if the generic one is missing
    if (!apiKey) {
      if (provider === 'sendgrid') apiKey = process.env.SENDGRID_API_KEY || '';
      else if (provider === 'resend') apiKey = process.env.RESEND_API_KEY || '';
    }

    this.config = {
      provider,
      apiKey,
      fromEmail: process.env.EMAIL_FROM_EMAIL || 'notifications@margin-finance.com',
      fromName: process.env.EMAIL_FROM_NAME || 'Margin Notifications',
      replyTo: process.env.EMAIL_REPLY_TO
    };
  }

  /**
   * Initialize the email service
   */
  async initialize(): Promise<void> {
    try {
      if (!this.config.apiKey) {
        throw new Error('EMAIL_API_KEY environment variable is required');
      }

      if (this.config.provider === 'sendgrid') {
        sgMail.setApiKey(this.config.apiKey);
        this.isInitialized = true;
        logger.info('Email service initialized with SendGrid');
      } else if (this.config.provider === 'postmark') {
        // Postmark initialization would go here
        this.isInitialized = true;
        logger.info('Email service initialized with Postmark');
      } else if (this.config.provider === 'resend') {
        this.resend = new Resend(this.config.apiKey);
        this.isInitialized = true;
        logger.info('Email service initialized with Resend');
      } else {
        throw new Error(`Unsupported email provider: ${this.config.provider}`);
      }
    } catch (error) {
      logger.error('Failed to initialize email service:', error);
      throw error;
    }
  }

  /**
   * Send a notification via email
   */
  async sendNotification(notification: Notification): Promise<void> {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      logger.info('Sending email notification', { 
        id: notification.id, 
        user_id: notification.user_id,
        type: notification.type 
      });

      const emailTemplate = this.generateEmailTemplate(notification);
      const recipientEmail = await this.getUserEmail(notification.user_id, notification.tenant_id);

      if (!recipientEmail) {
        throw new Error(`No email found for user: ${notification.user_id}`);
      }

      await this.sendEmail({
        to: recipientEmail,
        subject: emailTemplate.subject,
        html: emailTemplate.html,
        text: emailTemplate.text
      });

      logger.info('Email notification sent successfully', { 
        id: notification.id, 
        recipient: recipientEmail 
      });
    } catch (error) {
      logger.error('Error sending email notification:', error);
      throw error;
    }
  }

  /**
   * Send a custom email
   */
  async sendEmail(emailData: {
    to: string;
    subject: string;
    html: string;
    text: string;
    replyTo?: string;
  }): Promise<void> {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      if (this.config.provider === 'sendgrid') {
        await this.sendViaSendGrid(emailData);
      } else if (this.config.provider === 'postmark') {
        await this.sendViaPostmark(emailData);
      } else if (this.config.provider === 'resend') {
        await this.sendViaResend(emailData);
      } else {
        throw new Error(`Unsupported email provider: ${this.config.provider}`);
      }
    } catch (error) {
      logger.error('Error sending email:', error);
      throw error;
    }
  }

  /**
   * Send email via SendGrid
   */
  private async sendViaSendGrid(emailData: {
    to: string;
    subject: string;
    html: string;
    text: string;
    replyTo?: string;
  }): Promise<void> {
    const msg = {
      to: emailData.to,
      from: {
        email: this.config.fromEmail,
        name: this.config.fromName
      },
      subject: emailData.subject,
      html: emailData.html,
      text: emailData.text,
      replyTo: emailData.replyTo || this.config.replyTo
    };

    try {
      await sgMail.send(msg);
      logger.info('Email sent via SendGrid', { to: emailData.to, subject: emailData.subject });
    } catch (error) {
      logger.error('SendGrid error:', error);
      throw new Error(`SendGrid error: ${error}`);
    }
  }

  /**
   * Send email via Resend
   */
  private async sendViaResend(emailData: {
    to: string;
    subject: string;
    html: string;
    text: string;
    replyTo?: string;
  }): Promise<void> {
    if (!this.resend) {
      throw new Error('Resend client not initialized');
    }

    try {
      const { data, error } = await this.resend.emails.send({
        from: `${this.config.fromName} <${this.config.fromEmail}>`,
        to: [emailData.to],
        subject: emailData.subject,
        html: emailData.html,
        text: emailData.text,
        replyTo: emailData.replyTo || this.config.replyTo
      });

      if (error) {
        logger.error('Resend error:', error);
        throw new Error(`Resend error: ${error.message}`);
      }

      logger.info('Email sent via Resend', { to: emailData.to, subject: emailData.subject, id: data?.id });
    } catch (error) {
      logger.error('Resend catch error:', error);
      throw error;
    }
  }

  /**
   * Send email via Postmark
   */
  private async sendViaPostmark(emailData: {
    to: string;
    subject: string;
    html: string;
    text: string;
    replyTo?: string;
  }): Promise<void> {
    // TODO: Implement Postmark integration
    // This would use the Postmark API client
    logger.info('Postmark integration not yet implemented');
    throw new Error('Postmark integration not yet implemented');
  }

  /**
   * Generate email template based on notification type
   */
  private generateEmailTemplate(notification: Notification): EmailTemplate {
    const baseSubject = `[${notification.priority.toUpperCase()}] ${notification.title}`;
    
    // Generate HTML content
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${notification.title}</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
          .priority-urgent { border-left: 4px solid #dc3545; }
          .priority-high { border-left: 4px solid #fd7e14; }
          .priority-normal { border-left: 4px solid #ffc107; }
          .priority-low { border-left: 4px solid #28a745; }
          .content { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
          .footer { text-align: center; margin-top: 20px; color: #6c757d; font-size: 14px; }
          .btn { display: inline-block; padding: 10px 20px; background: #007bff; color: white; text-decoration: none; border-radius: 5px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header priority-${notification.priority}">
            <h2 style="margin: 0; color: #333;">${notification.title}</h2>
            <p style="margin: 5px 0 0 0; color: #666;">
              ${new Date(notification.created_at).toLocaleString()}
            </p>
          </div>
          
          <div class="content">
            <p>${notification.message}</p>
            
            ${notification.payload ? this.generatePayloadHTML(notification.payload) : ''}
            
            <div style="text-align: center; margin-top: 30px;">
              <a href="${process.env.FRONTEND_URL || 'https://app.margin-finance.com'}/notifications" class="btn">
                View in App
              </a>
            </div>
          </div>
          
          <div class="footer">
            <p>This is an automated notification from Margin.</p>
            <p>If you have any questions, please contact our support team.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    // Generate plain text content
    const text = `
${notification.title}
${'='.repeat(notification.title.length)}

${notification.message}

${notification.payload ? this.generatePayloadText(notification.payload) : ''}

View in App: ${process.env.FRONTEND_URL || 'https://app.margin-finance.com'}/notifications

---
This is an automated notification from Margin.
If you have any questions, please contact our support team.
    `;

    return {
      subject: baseSubject,
      html: html.trim(),
      text: text.trim()
    };
  }

  /**
   * Generate HTML for notification payload
   */
  private generatePayloadHTML(payload: Record<string, any>): string {
    const summary = this.buildPayloadSummary(payload);
    if (!summary.details.length && !summary.preview) return '';

    let html = '<div style="margin-top: 20px; padding: 15px; background: #f8f9fa; border-radius: 5px;">';
    html += '<h4 style="margin: 0 0 12px 0; color: #495057;">Additional Details:</h4>';

    for (const detail of summary.details) {
      html += `
        <div style="margin: 0 0 10px 0;">
          <div style="font-size: 12px; color: #6c757d; font-weight: 600; text-transform: uppercase; letter-spacing: 0.02em;">
            ${this.escapeHtml(detail.label)}
          </div>
          <div style="margin-top: 2px; color: #212529;">
            ${this.escapeHtml(detail.value)}
          </div>
        </div>
      `;
    }

    if (summary.preview) {
      html += `
        <div style="margin-top: 14px; padding: 12px 14px; background: white; border: 1px solid #e9ecef; border-radius: 6px;">
          <div style="font-size: 12px; color: #6c757d; font-weight: 600; text-transform: uppercase; letter-spacing: 0.02em;">
            Amazon message preview
          </div>
          <p style="margin: 8px 0 0 0; color: #495057;">
            ${this.escapeHtml(summary.preview)}
          </p>
        </div>
      `;
    }

    html += '</div>';
    return html;
  }

  /**
   * Generate plain text for notification payload
   */
  private generatePayloadText(payload: Record<string, any>): string {
    const summary = this.buildPayloadSummary(payload);
    if (!summary.details.length && !summary.preview) return '';

    let text = '\nAdditional Details:\n';
    text += '-'.repeat(20) + '\n';

    for (const detail of summary.details) {
      text += `${detail.label}: ${detail.value}\n`;
    }

    if (summary.preview) {
      text += `\nAmazon message preview:\n${summary.preview}\n`;
    }

    return text;
  }

  private buildPayloadSummary(payload: Record<string, any>): {
    details: Array<{ label: string; value: string }>;
    preview: string | null;
  } {
    const normalized = this.flattenPayload(payload);
    const details: Array<{ label: string; value: string }> = [];

    const amazonCaseId = this.pickPayloadString(normalized.amazon_case_id, normalized.amazonCaseId);
    const caseState = this.humanizeValue(this.pickPayloadString(normalized.case_state, normalized.caseState));
    const subject = this.pickPayloadString(normalized.subject);
    const disputeCaseId = this.pickPayloadString(normalized.dispute_case_id, normalized.disputeCaseId, normalized.disputeId);

    if (amazonCaseId) details.push({ label: 'Amazon case', value: amazonCaseId });
    if (caseState) details.push({ label: 'Case state', value: caseState });
    if (subject) details.push({ label: 'Subject', value: subject });
    if (disputeCaseId) details.push({ label: 'Margin case', value: disputeCaseId });

    if (!details.length) {
      const hiddenKeys = new Set([
        'payload',
        'metadata',
        'tenant_id',
        'tenant_slug',
        'user_id',
        'entity_id',
        'entity_type',
        'timestamp',
        'event_type',
        'preference_toggle_id',
        'dedupe_key',
        'provider_message_id'
      ]);

      for (const [key, value] of Object.entries(normalized)) {
        if (hiddenKeys.has(key) || value === null || value === undefined || typeof value === 'object') {
          continue;
        }

        details.push({
          label: key.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()),
          value: String(value)
        });

        if (details.length >= 4) {
          break;
        }
      }
    }

    return {
      details,
      preview: this.normalizePreview(this.pickPayloadString(normalized.body_preview, normalized.bodyPreview))
    };
  }

  private flattenPayload(payload: Record<string, any>): Record<string, any> {
    const flattened: Record<string, any> = {};
    let current: any = payload;
    let depth = 0;

    while (current && typeof current === 'object' && depth < 5) {
      for (const [key, value] of Object.entries(current)) {
        if (key === 'payload') {
          continue;
        }

        if (
          !Object.prototype.hasOwnProperty.call(flattened, key) ||
          flattened[key] === null ||
          flattened[key] === undefined ||
          flattened[key] === ''
        ) {
          flattened[key] = value;
        }
      }

      current = current.payload && typeof current.payload === 'object' ? current.payload : null;
      depth += 1;
    }

    return flattened;
  }

  private pickPayloadString(...values: any[]): string | null {
    for (const value of values) {
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
    }
    return null;
  }

  private humanizeValue(value: string | null): string | null {
    if (!value) return null;
    return value
      .split('_')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }

  private normalizePreview(value: string | null): string | null {
    if (!value) return null;
    const normalized = value.replace(/\s+/g, ' ').trim();
    if (!normalized) return null;
    return normalized.length > 280 ? `${normalized.slice(0, 277)}...` : normalized;
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * Get user email address from user ID
   * This would typically query your user management system
   */
  private async getUserEmail(userId: string, tenantId: string): Promise<string> {
    try {
      const { data: membership, error: membershipError } = await supabaseAdmin
        .from('tenant_memberships')
        .select('tenant_id')
        .eq('user_id', userId)
        .eq('tenant_id', tenantId)
        .eq('is_active', true)
        .maybeSingle();

      if (membershipError) {
        throw new Error(`EMAIL_RESOLUTION_FAILED:${membershipError.message}`);
      }

      if (!membership?.tenant_id) {
        throw new Error('EMAIL_RESOLUTION_FAILED');
      }

      const { data: user, error: userError } = await supabaseAdmin
        .from('users')
        .select('email')
        .eq('id', userId)
        .maybeSingle();

      if (userError) {
        throw new Error(`EMAIL_RESOLUTION_FAILED:${userError.message}`);
      }

      const email = String(user?.email || '').trim();
      if (!email) {
        throw new Error('EMAIL_RESOLUTION_FAILED');
      }

      return email;
    } catch (error) {
      logger.error('Error getting user email:', error);
      throw error instanceof Error ? error : new Error('EMAIL_RESOLUTION_FAILED');
    }
  }

  /**
   * Test email service connectivity
   */
  async testConnection(): Promise<boolean> {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      // Send a test email to verify connectivity
      const testEmail = {
        to: 'test@example.com',
        subject: 'Test Email',
        html: '<p>This is a test email to verify connectivity.</p>',
        text: 'This is a test email to verify connectivity.'
      };

      await this.sendEmail(testEmail);
      logger.info('Email service connectivity test passed');
      return true;
    } catch (error) {
      logger.error('Email service connectivity test failed:', error);
      return false;
    }
  }

  /**
   * Get email service configuration
   */
  getConfig(): EmailConfig {
    return { ...this.config };
  }

  /**
   * Update email service configuration
   */
  updateConfig(newConfig: Partial<EmailConfig>): void {
    this.config = { ...this.config, ...newConfig };
    this.isInitialized = false; // Force re-initialization
    logger.info('Email service configuration updated', newConfig);
  }
}

export default EmailService;

