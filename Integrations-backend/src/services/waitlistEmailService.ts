import { EmailService, EmailSendResult } from '../notifications/services/delivery/email_service';
import config from '../config/env';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function buildWaitlistConfirmationEmail(): {
  subject: string;
  html: string;
  text: string;
} {
  const subject = 'Welcome to Margin';
  const preheader = "You're officially on the waitlist.";

  const text = [
    'Welcome to Margin',
    '=================',
    '',
    "You're officially on the waitlist.",
    '',
    'Margin helps Amazon FBA sellers identify missed reimbursement opportunities and uncover what Amazon may owe them.',
    '',
    'We will let you know as soon as access opens.',
    '',
    'If you would like to be considered for early access, reply to this email with a brief note about your store and marketplace.',
    '',
    'Margin'
  ].join('\n');

  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${escapeHtml(subject)}</title>
      </head>
      <body style="margin:0; padding:0; background:#ffffff; color:#171717; font-family:Arial, Helvetica, sans-serif;">
        <div style="display:none; max-height:0; overflow:hidden; opacity:0;">
          ${escapeHtml(preheader)}
        </div>
        <div style="max-width:600px; margin:0 auto; padding:36px 24px 40px 24px;">
          <div style="border-bottom:1px solid #e5e5e5; padding-bottom:20px;">
            <div style="font-size:12px; letter-spacing:0.18em; text-transform:uppercase; color:#111827; font-weight:700;">
              Margin
            </div>
            <h1 style="margin:28px 0 0 0; font-size:28px; line-height:1.18; font-weight:600; color:#111827;">
              Welcome to Margin
            </h1>
            <p style="margin:14px 0 0 0; color:#404040; font-size:16px; line-height:1.7;">
              You're officially on the waitlist.
            </p>
          </div>

          <div style="padding-top:24px;">
            <p style="margin:0; color:#262626; font-size:15px; line-height:1.8;">
              Margin helps Amazon FBA sellers identify missed reimbursement opportunities and uncover what Amazon may owe them.
            </p>

            <p style="margin:20px 0 0 0; color:#262626; font-size:15px; line-height:1.8;">
              We will let you know as soon as access opens.
            </p>

            <div style="margin-top:24px; padding-top:20px; border-top:1px solid #eeeeee;">
              <p style="margin:0; color:#111827; font-size:14px; line-height:1.7; font-weight:600;">
                Early access
              </p>
              <p style="margin:10px 0 0 0; color:#262626; font-size:15px; line-height:1.8;">
                If you would like to be considered for early access, reply to this email with a brief note about your store and marketplace.
              </p>
            </div>

            <p style="margin:28px 0 0 0; color:#171717; font-size:15px; line-height:1.7;">
              Margin
            </p>
          </div>
        </div>
      </body>
    </html>
  `;

  return {
    subject,
    html: html.trim(),
    text
  };
}

export interface WaitlistLeadCaptureInput {
  email: string;
  user_type?: string | null;
  brand_count?: string | null;
  annual_revenue?: string | null;
  contact_handle?: string | null;
  primary_goal?: string | null;
  source_page?: string | null;
  intent?: string | null;
  reason?: string | null;
  user_agent?: string | null;
  ip?: string | null;
}

function buildWaitlistLeadCaptureEmail(input: WaitlistLeadCaptureInput): {
  subject: string;
  html: string;
  text: string;
} {
  const subject = `New waitlist lead: ${input.email.trim().toLowerCase()}`;
  const detailLines = [
    ['Email', input.email],
    ['User type', input.user_type || 'Not provided'],
    ['Brand count', input.brand_count || 'Not provided'],
    ['Annual revenue', input.annual_revenue || 'Not provided'],
    ['Primary goal', input.primary_goal || 'Not provided'],
    ['Contact handle', input.contact_handle || 'Not provided'],
    ['Source page', input.source_page || 'Not provided'],
    ['Intent', input.intent || 'Not provided'],
    ['Reason', input.reason || 'Not provided'],
    ['IP', input.ip || 'Not provided'],
    ['User agent', input.user_agent || 'Not provided'],
  ];

  const text = [
    'New Margin waitlist lead',
    '========================',
    '',
    ...detailLines.map(([label, value]) => `${label}: ${value}`),
    '',
    `Captured at: ${new Date().toISOString()}`,
  ].join('\n');

  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${escapeHtml(subject)}</title>
      </head>
      <body style="margin:0; padding:0; background:#ffffff; color:#171717; font-family:Arial, Helvetica, sans-serif;">
        <div style="max-width:640px; margin:0 auto; padding:32px 24px;">
          <div style="border-bottom:1px solid #e5e5e5; padding-bottom:18px;">
            <div style="font-size:12px; letter-spacing:0.18em; text-transform:uppercase; color:#111827; font-weight:700;">
              Margin waitlist
            </div>
            <h1 style="margin:22px 0 0 0; font-size:26px; line-height:1.2; font-weight:600; color:#111827;">
              New waitlist lead captured
            </h1>
          </div>
          <div style="padding-top:24px;">
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="width:100%; border-collapse:collapse;">
              ${detailLines.map(([label, value]) => `
                <tr>
                  <td style="padding:10px 0; border-bottom:1px solid #f1f1f1; width:180px; vertical-align:top; color:#6b7280; font-size:13px; font-weight:600;">
                    ${escapeHtml(label)}
                  </td>
                  <td style="padding:10px 0; border-bottom:1px solid #f1f1f1; color:#111827; font-size:14px; line-height:1.6;">
                    ${escapeHtml(String(value))}
                  </td>
                </tr>
              `).join('')}
            </table>
            <p style="margin:18px 0 0 0; color:#6b7280; font-size:13px; line-height:1.6;">
              Captured at ${escapeHtml(new Date().toISOString())}
            </p>
          </div>
        </div>
      </body>
    </html>
  `;

  return {
    subject,
    html: html.trim(),
    text,
  };
}

class WaitlistEmailService {
  private emailService = new EmailService();

  async sendWaitlistConfirmationEmail(email: string): Promise<EmailSendResult> {
    const recipient = email.trim().toLowerCase();
    const template = buildWaitlistConfirmationEmail();

    return this.emailService.sendEmail({
      to: recipient,
      subject: template.subject,
      html: template.html,
      text: template.text,
      replyTo: 'support@margin-finance.com'
    });
  }

  async sendWaitlistLeadCaptureEmail(input: WaitlistLeadCaptureInput): Promise<EmailSendResult> {
    const recipient = config.WAITLIST_CAPTURE_EMAIL.trim().toLowerCase();
    const template = buildWaitlistLeadCaptureEmail(input);

    return this.emailService.sendEmail({
      to: recipient,
      subject: template.subject,
      html: template.html,
      text: template.text,
      replyTo: input.email.trim().toLowerCase(),
    });
  }
}

export const waitlistEmailService = new WaitlistEmailService();
