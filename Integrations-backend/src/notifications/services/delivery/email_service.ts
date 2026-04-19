import { getLogger } from '../../../utils/logger';
import Notification from '../../models/notification';
import sgMail from '@sendgrid/mail';
import { Resend } from 'resend';
import { supabaseAdmin } from '../../../database/supabaseClient';
import { buildNotificationEmailViewModel } from './email_presenter';

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
    const emailView = buildNotificationEmailViewModel(notification, {
      frontendUrl: process.env.FRONTEND_URL || 'https://app.margin-finance.com'
    });
    const htmlWhatChanged = this.renderListSectionHtml('What changed', emailView.what_changed_lines);
    const textWhatChanged = this.renderListSectionText('What changed', emailView.what_changed_lines);
    const htmlDetails = this.renderDetailLinesHtml(
      emailView.email_detail_lines,
      emailView.detail_heading || 'Additional Details:'
    );
    const textDetails = this.renderDetailLinesText(
      emailView.email_detail_lines,
      emailView.detail_heading || 'Additional Details'
    );
    const htmlSellerAction = this.renderCalloutHtml('Seller action', emailView.seller_action_text);
    const textSellerAction = this.renderCalloutText('Seller action', emailView.seller_action_text);
    const htmlDisclaimer = this.renderSecondaryNoteHtml(emailView.disclaimer_text);
    const textDisclaimer = this.renderSecondaryNoteText(emailView.disclaimer_text);

    // Generate HTML content
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${this.escapeHtml(emailView.email_heading)}</title>
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
            <h2 style="margin: 0; color: #333;">${this.escapeHtml(emailView.email_heading)}</h2>
          </div>
          
          <div class="content">
            <p>${this.escapeHtml(emailView.email_summary)}</p>

            ${htmlWhatChanged}

            ${htmlDetails}

            ${emailView.why_this_matters ? `
              <div style="margin-top: 18px; padding: 14px 16px; background: #fff8e8; border-radius: 6px; border-left: 3px solid #f59e0b;">
                <div style="font-size: 12px; color: #92400e; font-weight: 600; letter-spacing: 0.02em;">
                  Why this matters
                </div>
                <p style="margin: 8px 0 0 0; color: #78350f;">
                  ${this.escapeHtml(emailView.why_this_matters)}
                </p>
              </div>
            ` : ''}

            ${emailView.amazon_said_preview ? `
              <div style="margin-top: 18px; padding: 14px 16px; background: #f8f9fa; border-radius: 6px;">
                <div style="font-size: 12px; color: #6c757d; font-weight: 600; letter-spacing: 0.02em;">
                  What Amazon said
                </div>
                <p style="margin: 8px 0 0 0; color: #495057;">
                  &ldquo;${this.escapeHtml(emailView.amazon_said_preview)}&rdquo;
                </p>
              </div>
            ` : ''}

            ${emailView.trust_line ? `
              <p style="margin-top: 18px; color: #495057;">
                ${this.escapeHtml(emailView.trust_line)}
              </p>
            ` : ''}

            ${emailView.what_to_do_next ? `
              <div style="margin-top: 18px; padding: 14px 16px; background: #f8f9fa; border-radius: 6px;">
                <div style="font-size: 12px; color: #6c757d; font-weight: 600; text-transform: uppercase; letter-spacing: 0.02em;">
                  What to do next
                </div>
                <p style="margin: 8px 0 0 0; color: #495057;">
                  ${this.escapeHtml(emailView.what_to_do_next)}
                </p>
              </div>
            ` : ''}

            ${htmlSellerAction}

            ${htmlDisclaimer}
            
            <div style="text-align: center; margin-top: 30px;">
              <a href="${this.escapeHtml(emailView.action_url)}" class="btn">
                ${this.escapeHtml(emailView.action_label)}
              </a>
            </div>

            <p style="margin: 18px 0 0 0; color: #6c757d; font-size: 13px;">
              If the button doesn’t work, copy and paste this link:
            </p>
            <p style="margin: 8px 0 0 0; word-break: break-all; font-size: 13px;">
              <a href="${this.escapeHtml(emailView.action_url)}" style="color: #007bff; text-decoration: underline;">
                ${this.escapeHtml(emailView.action_url)}
              </a>
            </p>
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
${emailView.email_heading}
${'='.repeat(emailView.email_heading.length)}

${emailView.email_summary}

${textWhatChanged}

${textDetails}

${emailView.why_this_matters ? `Why this matters:\n${emailView.why_this_matters}\n\n` : ''}${emailView.amazon_said_preview ? `What Amazon said:\n"${emailView.amazon_said_preview}"\n\n` : ''}${emailView.trust_line ? `${emailView.trust_line}\n\n` : ''}${emailView.what_to_do_next ? `What to do next:\n${emailView.what_to_do_next}\n\n` : ''}${textSellerAction}${textDisclaimer}View in App: ${emailView.action_url}

If the button doesn’t work, copy and paste this link:
${emailView.action_url}

---
This is an automated notification from Margin.
If you have any questions, please contact our support team.
    `;

    return {
      subject: emailView.email_subject,
      html: html.trim(),
      text: text.trim()
    };
  }

  private renderDetailLinesHtml(details: Array<{ label: string; value: string }>, heading: string): string {
    if (!details.length) return '';

    const rows = details
      .map(
        (detail) => `
          <div style="margin: 0 0 10px 0;">
            <div style="font-size: 12px; color: #6c757d; font-weight: 600; text-transform: uppercase; letter-spacing: 0.02em;">
              ${this.escapeHtml(detail.label)}
            </div>
            <div style="margin-top: 2px; color: #212529;">
              ${this.escapeHtml(detail.value)}
            </div>
          </div>
        `
      )
      .join('');

    return `
      <div style="margin-top: 20px; padding: 15px; background: #f8f9fa; border-radius: 5px;">
        <h4 style="margin: 0 0 12px 0; color: #495057;">${this.escapeHtml(heading)}</h4>
        ${rows}
      </div>
    `;
  }

  private renderDetailLinesText(details: Array<{ label: string; value: string }>, heading: string): string {
    if (!details.length) return '';

    let text = `\n${heading}:\n`;
    text += '-'.repeat(Math.max(heading.length, 20)) + '\n';
    for (const detail of details) {
      text += `${detail.label}: ${detail.value}\n`;
    }

    return text;
  }

  private renderListSectionHtml(heading: string, lines?: string[] | null): string {
    const cleanedLines = (lines || []).filter((line) => typeof line === 'string' && line.trim());
    if (!cleanedLines.length) return '';

    const items = cleanedLines
      .map(
        (line) => `
          <li style="margin: 0 0 8px 0; color: #212529;">
            ${this.escapeHtml(line)}
          </li>
        `
      )
      .join('');

    return `
      <div style="margin-top: 18px; padding: 16px; background: #f8f9fa; border-radius: 6px; border-left: 3px solid #212529;">
        <div style="font-size: 12px; color: #495057; font-weight: 700; text-transform: uppercase; letter-spacing: 0.02em;">
          ${this.escapeHtml(heading)}
        </div>
        <ul style="margin: 10px 0 0 18px; padding: 0;">
          ${items}
        </ul>
      </div>
    `;
  }

  private renderListSectionText(heading: string, lines?: string[] | null): string {
    const cleanedLines = (lines || []).filter((line) => typeof line === 'string' && line.trim());
    if (!cleanedLines.length) return '';

    let text = `${heading}:\n`;
    text += '-'.repeat(Math.max(heading.length, 20)) + '\n';
    for (const line of cleanedLines) {
      text += `- ${line}\n`;
    }

    return `${text}\n`;
  }

  private renderCalloutHtml(heading: string, value?: string | null): string {
    if (!value) return '';

    return `
      <div style="margin-top: 18px; padding: 14px 16px; background: #eef7f0; border-radius: 6px;">
        <div style="font-size: 12px; color: #2f6f3e; font-weight: 700; text-transform: uppercase; letter-spacing: 0.02em;">
          ${this.escapeHtml(heading)}
        </div>
        <p style="margin: 8px 0 0 0; color: #24542f;">
          ${this.escapeHtml(value)}
        </p>
      </div>
    `;
  }

  private renderCalloutText(heading: string, value?: string | null): string {
    if (!value) return '';
    return `${heading}:\n${value}\n\n`;
  }

  private renderSecondaryNoteHtml(value?: string | null): string {
    if (!value) return '';

    return `
      <p style="margin: 18px 0 0 0; color: #6c757d; font-size: 13px; line-height: 1.5;">
        ${this.escapeHtml(value)}
      </p>
    `;
  }

  private renderSecondaryNoteText(value?: string | null): string {
    if (!value) return '';
    return `${value}\n\n`;
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

