import { getLogger } from '../../utils/logger';
import * as AWS from 'aws-sdk';
import * as fs from 'fs';
import * as path from 'path';

const logger = getLogger('EmailService');

export interface EmailTemplate {
  subject: string;
  html: string;
  text?: string;
}

export interface EmailOptions {
  to: string;
  from?: string;
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
}

class EmailService {
  private ses: AWS.SES | null = null;
  private sendGrid: any = null;
  private templatesPath: string;

  constructor() {
    this.templatesPath = path.join(__dirname, '../templates/email');
    this.initializeEmailProvider();
  }

  private initializeEmailProvider(): void {
    const emailProvider = process.env.EMAIL_PROVIDER || 'ses';

    if (emailProvider === 'ses') {
      this.initializeSES();
    } else if (emailProvider === 'sendgrid') {
      this.initializeSendGrid();
    } else {
      logger.warn(`Unsupported email provider: ${emailProvider}`);
    }
  }

  private initializeSES(): void {
    try {
      this.ses = new AWS.SES({
        region: process.env.AWS_REGION || 'us-east-1',
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      });
      logger.info('Initialized AWS SES email service');
    } catch (error) {
      logger.error('Failed to initialize AWS SES:', error);
    }
  }

  private initializeSendGrid(): void {
    try {
      const sgMail = require('@sendgrid/mail');
      sgMail.setApiKey(process.env.SENDGRID_API_KEY);
      this.sendGrid = sgMail;
      logger.info('Initialized SendGrid email service');
    } catch (error) {
      logger.error('Failed to initialize SendGrid:', error);
    }
  }

  async loadTemplate(templateName: string): Promise<string> {
    try {
      const templatePath = path.join(this.templatesPath, `${templateName}.html`);
      const template = fs.readFileSync(templatePath, 'utf8');
      return template;
    } catch (error) {
      logger.error(`Failed to load template ${templateName}:`, error);
      throw new Error(`Template ${templateName} not found`);
    }
  }

  private replacePlaceholders(template: string, data: Record<string, any>): string {
    let result = template;
    for (const [key, value] of Object.entries(data)) {
      const placeholder = `{{${key}}}`;
      result = result.replace(new RegExp(placeholder, 'g'), String(value));
    }
    return result;
  }

  async sendEmail(options: EmailOptions): Promise<boolean> {
    try {
      if (this.ses) {
        return await this.sendViaSES(options);
      } else if (this.sendGrid) {
        return await this.sendViaSendGrid(options);
      } else {
        logger.error('No email provider configured');
        return false;
      }
    } catch (error) {
      logger.error('Failed to send email:', error);
      return false;
    }
  }

  private async sendViaSES(options: EmailOptions): Promise<boolean> {
    if (!this.ses) return false;

    const params: AWS.SES.SendEmailRequest = {
      Source: options.from || process.env.SES_FROM_EMAIL || 'noreply@opsided.com',
      Destination: {
        ToAddresses: [options.to],
      },
      Message: {
        Subject: {
          Data: options.subject,
          Charset: 'UTF-8',
        },
        Body: {
          Html: {
            Data: options.html,
            Charset: 'UTF-8',
          },
          ...(options.text && {
            Text: {
              Data: options.text,
              Charset: 'UTF-8',
            },
          }),
        },
      },
      ...(options.replyTo && {
        ReplyToAddresses: [options.replyTo],
      }),
    };

    try {
      const result = await this.ses.sendEmail(params).promise();
      logger.info(`Email sent via SES: ${result.MessageId}`);
      return true;
    } catch (error) {
      logger.error('Failed to send email via SES:', error);
      return false;
    }
  }

  private async sendViaSendGrid(options: EmailOptions): Promise<boolean> {
    if (!this.sendGrid) return false;

    const msg = {
      to: options.to,
      from: options.from || process.env.SENDGRID_FROM_EMAIL || 'noreply@opsided.com',
      subject: options.subject,
      html: options.html,
      ...(options.text && { text: options.text }),
      ...(options.replyTo && { replyTo: options.replyTo }),
    };

    try {
      await this.sendGrid.send(msg);
      logger.info(`Email sent via SendGrid to ${options.to}`);
      return true;
    } catch (error) {
      logger.error('Failed to send email via SendGrid:', error);
      return false;
    }
  }

  async sendTemplatedEmail(
    to: string,
    templateName: string,
    data: Record<string, any>,
    subject?: string
  ): Promise<boolean> {
    try {
      const template = await this.loadTemplate(templateName);
      const html = this.replacePlaceholders(template, data);
      const emailSubject = subject || this.extractSubjectFromTemplate(template);

      return await this.sendEmail({
        to,
        subject: emailSubject,
        html,
      });
    } catch (error) {
      logger.error(`Failed to send templated email ${templateName}:`, error);
      return false;
    }
  }

  private extractSubjectFromTemplate(template: string): string {
    const titleMatch = template.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleMatch) {
      return titleMatch[1].trim();
    }
    return 'Notification from Opside';
  }

  async validateEmail(email: string): Promise<boolean> {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  async getSendQuota(): Promise<any> {
    if (!this.ses) return null;

    try {
      const quota = await this.ses.getSendQuota().promise();
      return quota;
    } catch (error) {
      logger.error('Failed to get send quota:', error);
      return null;
    }
  }
}

export const emailService = new EmailService();
export default emailService; 